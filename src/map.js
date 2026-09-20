/** Leaflet map: user position, search radius and spot markers. */

import { TILE_URL, TILE_ATTRIBUTION } from './config.js';
import { WATER_TYPES } from './species.js';
import { formatDistance } from './util.js';

export function createMap(elementId, { onPick } = {}) {
  const map = L.map(elementId, {
    zoomControl: true,
    attributionControl: true,
    tap: true,
  }).setView([61.4978, 23.761], 11);

  L.tileLayer(TILE_URL, {
    maxZoom: 19,
    attribution: TILE_ATTRIBUTION,
  }).addTo(map);

  const spotLayer = L.layerGroup().addTo(map);
  let userMarker = null;
  let accuracyCircle = null;
  let radiusCircle = null;
  const markersById = new Map();
  let selectedId = null;

  map.on('click', (event) => {
    onPick?.({ lat: event.latlng.lat, lon: event.latlng.lng });
  });

  function setUserLocation({ lat, lon, accuracy = null }) {
    const position = [lat, lon];
    if (!userMarker) {
      userMarker = L.marker(position, {
        icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
        keyboard: false,
        interactive: false,
        zIndexOffset: 1000,
      }).addTo(map);
    } else {
      userMarker.setLatLng(position);
    }

    if (accuracyCircle) accuracyCircle.remove();
    if (accuracy && accuracy > 30) {
      // Colours live in CSS so the rings follow the light/dark theme.
      accuracyCircle = L.circle(position, {
        radius: accuracy,
        className: 'accuracy-ring',
        weight: 1,
        interactive: false,
      }).addTo(map);
    }
  }

  function setRadius({ lat, lon, radiusKm }) {
    if (radiusCircle) radiusCircle.remove();
    radiusCircle = L.circle([lat, lon], {
      radius: radiusKm * 1000,
      className: 'radius-ring',
      weight: 1,
      fill: false,
      interactive: false,
    }).addTo(map);
  }

  /**
   * Compare what is actually drawn, not the underlying fields: a spot can
   * learn which lake it belongs to without its pin looking any different, and
   * replacing the element for that would make the marker blink.
   */
  function iconHtmlFor(spot) {
    const type = WATER_TYPES[spot.waterType] || WATER_TYPES.tuntematon;
    const glyph = spot.isFishingSpot ? '🎣' : type.icon;
    const classes = [
      'pin',
      spot.isFishingSpot ? 'pin-spot' : 'pin-water',
      // Selection is part of what the pin draws, so it survives every update.
      spot.id === selectedId ? 'is-active' : '',
    ].filter(Boolean).join(' ');
    return `<div class="${classes}" data-id="${spot.id}"><span>${glyph}</span></div>`;
  }

  const iconFor = (spot) => L.divIcon({
    className: '',
    html: iconHtmlFor(spot),
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    popupAnchor: [0, -24],
  });

  const popupFor = (spot) => {
    const type = WATER_TYPES[spot.waterType] || WATER_TYPES.tuntematon;
    return `<b>${escapeForPopup(spot.name)}</b>${type.label} · ${formatDistance(spot.distanceKm)}`;
  };

  /**
   * Reconcile the markers with the given spots: remove what is gone, add what
   * is new, and leave untouched markers alone. Clearing and rebuilding the
   * whole layer made every marker blink on each partial update.
   */
  function setSpots(spots, { onSelect } = {}) {
    const wanted = new Map(spots.map((spot) => [spot.id, spot]));

    for (const [id, marker] of markersById) {
      if (!wanted.has(id)) {
        spotLayer.removeLayer(marker);
        markersById.delete(id);
      }
    }

    for (const spot of spots) {
      const existing = markersById.get(spot.id);
      if (existing) {
        existing.spotData = spot;                       // keep the click payload fresh

        const html = iconHtmlFor(spot);
        if (existing.iconHtml !== html) {
          existing.setIcon(iconFor(spot));              // this replaces the element
          existing.iconHtml = html;
        }
        const popup = popupFor(spot);
        if (existing.popupHtml !== popup) {
          existing.setPopupContent(popup);
          existing.popupHtml = popup;
        }
        if (existing.options.title !== spot.name) {
          existing.options.title = spot.name;
          existing.getElement()?.setAttribute('title', spot.name);
        }
        continue;
      }

      const type = WATER_TYPES[spot.waterType] || WATER_TYPES.tuntematon;
      const marker = L.marker([spot.lat, spot.lon], {
        icon: iconFor(spot),
        title: spot.name,
        alt: `${spot.name}, ${type.label}`,
        riseOnHover: true,
      });
      marker.spotData = spot;
      marker.iconHtml = iconHtmlFor(spot);
      marker.popupHtml = popupFor(spot);
      marker.bindPopup(marker.popupHtml);
      marker.on('click', () => onSelect?.(marker.spotData));
      marker.addTo(spotLayer);
      markersById.set(spot.id, marker);
    }
  }

  /** Mark one spot as the selected one and redraw only the pins that change. */
  function highlightSpot(spotId, { openPopup = false } = {}) {
    const previousId = selectedId;
    selectedId = spotId;

    for (const id of [previousId, spotId]) {
      const marker = id && markersById.get(id);
      if (!marker?.spotData) continue;
      const html = iconHtmlFor(marker.spotData);
      if (marker.iconHtml !== html) {
        marker.setIcon(iconFor(marker.spotData));
        marker.iconHtml = html;
      }
      marker.setZIndexOffset(id === spotId ? 1000 : 0);
    }

    const marker = markersById.get(spotId);
    if (marker && openPopup) marker.openPopup();
    return marker;
  }

  /**
   * `offsetY` is how many pixels of the map are covered from the bottom
   * (the sheet on a phone). The target is lifted by half of it so it lands in
   * the middle of what the user can actually see.
   */
  function flyTo(lat, lon, zoom = map.getZoom(), { offsetY = 0 } = {}) {
    const targetZoom = Math.max(zoom, 12);
    let center = L.latLng(lat, lon);
    if (offsetY > 0) {
      const point = map.project(center, targetZoom).add([0, offsetY / 2]);
      center = map.unproject(point, targetZoom);
    }
    map.flyTo(center, targetZoom, { duration: 0.7 });
  }

  function fitTo(lat, lon, radiusKm, { offsetY = 0 } = {}) {
    const bounds = L.latLng(lat, lon).toBounds(radiusKm * 2000);
    map.fitBounds(bounds, {
      paddingTopLeft: [24, 24],
      paddingBottomRight: [24, 24 + offsetY],
    });
  }

  return { map, setUserLocation, setRadius, setSpots, highlightSpot, flyTo, fitTo, invalidate: () => map.invalidateSize() };
}

function escapeForPopup(text) {
  return String(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}
