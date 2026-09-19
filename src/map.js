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

  function setSpots(spots, { onSelect } = {}) {
    spotLayer.clearLayers();
    markersById.clear();

    for (const spot of spots) {
      const type = WATER_TYPES[spot.waterType] || WATER_TYPES.tuntematon;
      const marker = L.marker([spot.lat, spot.lon], {
        icon: L.divIcon({
          className: '',
          html: `<div class="pin ${spot.isFishingSpot ? 'pin-spot' : 'pin-water'}" data-id="${spot.id}"><span>${spot.isFishingSpot ? '🎣' : type.icon}</span></div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 26],
          popupAnchor: [0, -24],
        }),
        title: spot.name,
        alt: `${spot.name}, ${type.label}`,
        riseOnHover: true,
      });

      marker.bindPopup(
        `<b>${escapeForPopup(spot.name)}</b>${type.label} · ${formatDistance(spot.distanceKm)}`,
      );
      marker.on('click', () => onSelect?.(spot));
      marker.addTo(spotLayer);
      markersById.set(spot.id, marker);
    }
  }

  function highlightSpot(spotId, { openPopup = false } = {}) {
    for (const [id, marker] of markersById) {
      const pin = marker.getElement()?.querySelector('.pin');
      pin?.classList.toggle('is-active', id === spotId);
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
