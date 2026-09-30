const $ = (selector) => document.querySelector(selector);
const html = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const state = { places: [], routes: [], tab: 'routes', routeType: '全部', placeTag: '全部', district: '全部', query: '', selected: null, map: null, provider: '' };
const placeById = () => new Map(state.places.map((place) => [place.id, place]));
const isMobile = () => matchMedia('(max-width: 700px)').matches;
const routeColor = (route) => route.type === '徒步' ? '#478562' : '#d48b52';
const markerGroup = (place) => {
  if (place.tags?.includes('博物馆') || place.tags?.includes('科技馆')) return 'museum';
  if (place.tags?.includes('商场') || place.tags?.includes('商业街')) return 'shopping';
  if (place.tags?.includes('游玩')) return 'fun';
  if (place.tags?.some((tag) => ['古迹', '历史街区', '遗址公园'].includes(tag))) return 'heritage';
  return 'nature';
};
const selectedPlaces = () => state.places.filter((place) => (state.placeTag === '全部' || place.tags?.includes(state.placeTag)) && (state.district === '全部' || place.district === state.district));
const selectedPlaceIds = () => new Set(selectedPlaces().map((place) => place.id));
const selectedRoutes = () => {
  const ids = selectedPlaceIds();
  return state.routes.filter((route) => (state.routeType === '全部' || route.type === state.routeType) && route.stops.some((id) => ids.has(id)));
};
function refreshMap() {
  state.map?.setVisible(selectedPlaceIds(), new Set(selectedRoutes().map((route) => route.id)));
  if (state.placeTag !== '全部' || state.district !== '全部') state.map?.focusPlaces(selectedPlaces());
  else state.map?.reset();
}

function sourceMarkup(sources) {
  return `<ul class="source-list">${sources.map((s) => `<li><a href="${html(s.url)}" target="_blank" rel="noopener noreferrer">↗ ${html(s.label)}</a></li>`).join('')}</ul>`;
}

function setTab(tab) {
  state.tab = tab;
  $('#tab-routes').classList.toggle('active', tab === 'routes');
  $('#tab-places').classList.toggle('active', tab === 'places');
  $('#tab-routes').setAttribute('aria-selected', tab === 'routes');
  $('#tab-places').setAttribute('aria-selected', tab === 'places');
  $('#list-title').textContent = tab === 'routes' ? '精选路线' : '沿途地点';
  $('#taxonomy-hint').textContent = '主题与区域同时筛选地点，并保留包含这些地点的路线。';
  renderFilters();
  renderList();
}

function renderFilters() {
  const featuredTags = ['博物馆', '商场', '游玩', '自然风景', '历史街区', '古迹', '文创空间', '遗址公园'];
  const filters = ['全部', ...featuredTags.filter((tag) => state.places.some((place) => place.tags?.includes(tag)))];
  $('#filters').innerHTML = filters.map((filter) => `<button class="filter ${filter === state.placeTag ? 'active' : ''}" type="button" data-filter="${html(filter)}">${html(filter)}</button>`).join('');
  $('#route-types').innerHTML = ['全部', '徒步', '逛玩'].map((type) => `<button class="filter ${type === state.routeType ? 'active' : ''}" type="button" data-route-type="${html(type)}">${html(type === '全部' ? '全部路线' : type)}</button>`).join('');
  const districts = [...new Set(state.places.map((place) => place.district).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  $('#district-filter').innerHTML = `<option value="全部">全部区域</option>${districts.map((district) => `<option value="${html(district)}" ${district === state.district ? 'selected' : ''}>${html(district)}</option>`).join('')}`;
}

function matchQuery(item, query) {
  if (!query) return true;
  const stops = item.stops?.map((id) => placeById().get(id)?.name).join(' ') || '';
  return [item.name, item.region, item.district, item.type, item.category, ...(item.tags || []), item.summary, item.experience, item.see, item.description, stops].filter(Boolean).join(' ').toLocaleLowerCase().includes(query);
}

function renderList() {
  const query = state.query.trim().toLocaleLowerCase();
  const items = state.tab === 'routes' ? selectedRoutes() : selectedPlaces();
  const filtered = items.filter((item) => matchQuery(item, query));
  $('#result-count').textContent = `${filtered.length} 个结果`;
  $('#item-list').innerHTML = filtered.length ? filtered.map((item) => state.tab === 'routes' ? routeCard(item) : placeCard(item)).join('') : '<div class="empty-state">没有找到匹配内容。试试其他关键词或筛选条件。</div>';
}

function routeCard(route) {
  const selected = state.selected?.kind === 'route' && state.selected.id === route.id;
  const typeClass = route.type === '徒步' ? 'hike' : 'walk';
  return `<button class="item-card ${selected ? 'selected' : ''}" type="button" data-kind="route" data-id="${html(route.id)}"><div class="card-kicker"><span class="pill ${typeClass}">${html(route.type)}</span><span>NO. ${String(route.order).padStart(2, '0')} · ${html(route.region)}</span></div><div class="card-title">${html(route.name)}</div><p class="card-summary">${html(route.summary)}</p><div class="card-meta"><span>${html(route.duration)}</span><span>${html(route.distance)}</span><span>难度 ${html(route.difficulty)}</span><span class="editor-score">推荐 ${html(route.recommendIndex)}/5</span></div></button>`;
}

function placeCard(place) {
  const selected = state.selected?.kind === 'place' && state.selected.id === place.id;
  return `<button class="item-card ${selected ? 'selected' : ''}" type="button" data-kind="place" data-id="${html(place.id)}"><div class="card-kicker"><span class="pill place-${markerGroup(place)}">${html(place.category)}</span><span>${html(place.district)} · 高德 ${place.amapRating ? html(place.amapRating.score) + '/5' : '暂无评分'}</span></div><div class="card-title">${html(place.name)}</div><p class="card-summary">${html(place.description || place.see)}</p><div class="card-meta"><span>停留 ${html(place.stay)} 分钟</span><span class="editor-score">推荐 ${html(place.recommendIndex)}/5</span></div></button>`;
}

function renderRouteDetail(route) {
  const places = placeById();
  const stops = route.stops.map((id, index) => {
    const place = places.get(id);
    return place ? `<li><span class="stop-number">${index + 1}</span><button type="button" data-stop="${html(id)}">${html(place.name)}</button><small>${html(place.see)}</small></li>` : '';
  }).join('');
  const ratingText = route.amapRatingSummary?.count > 0 ? `${html(route.amapRatingSummary.average)}/5 · ${route.amapRatingSummary.count} 个地点` : '暂无可用评分';
  $('#detail-content').innerHTML = `<div class="detail-inner">
    <div class="detail-overline">${html(route.type)} · ${html(route.region)} · NO. ${String(route.order).padStart(2, '0')}</div>
    <h2>${html(route.name)}</h2><p class="detail-description">${html(route.summary)}</p>
    <div class="detail-facts">
      <div><small>建议用时</small><b>${html(route.duration)}</b></div>
      <div><small>${html(route.distanceLabel || '资料参考里程')}</small><b>${html(route.distance)}</b></div>
      <div><small>推荐指数</small><b class="editor-score">★ ${html(route.recommendIndex)}/5</b></div>
      <div><small>沿途高德评分均值</small><b>${ratingText}</b></div>
      <div><small>难度</small><b>${html(route.difficulty)}</b></div>
      <div><small>适合季节</small><b>${html(route.season)}</b></div>
    </div>
    <p class="rating-note">推荐指数是本站编辑判断；路线均值仅由有高德评分的沿途地点计算，不是高德对整条路线的评分。评分核对于 ${html(route.amapRatingSummary?.checkedAt || route.checkedAt)}。</p>
    <section class="detail-section"><h3>这条路线能看到什么</h3><p>${html(route.experience || route.summary)}</p></section>
    <section class="detail-section"><h3>为什么推荐</h3><p>${html(route.reason)}</p></section>
    ${route.difficultyNote ? `<section class="detail-section"><h3>难度说明</h3><p>${html(route.difficultyNote)}</p></section>` : ''}
    <section class="detail-section"><h3>沿途地点 · 点击查看详情</h3><ol class="stop-list">${stops}</ol></section>
    <section class="detail-section"><h3>出发前留意</h3><p>${html(route.tip)}</p></section>
    <section class="detail-section"><h3>线路说明</h3><p class="accuracy-note">${html(route.lineLabel)}。图上折线不能用于寻路或判断路况；${route.distanceLabel === '轨迹长度估算' ? '里程由来源坐标估算，尚待实地复核。' : route.distanceLabel ? '请按详情提示核对交通与里程。' : '里程来自资料，不按图上折线计算。'}${html(route.status)}。</p></section>
    <section class="detail-section"><h3>资料来源</h3>${sourceMarkup(route.sources)}<p style="margin-top:8px">核对日期：${html(route.checkedAt)}</p></section>
  </div>`;
}

function renderPlaceDetail(place) {
  const routes = state.routes.filter((route) => route.stops.includes(place.id));
  const routeLinks = routes.length ? routes.map((route) => `<button type="button" data-route-link="${html(route.id)}">${html(route.name)} ↗</button>`).join('') : '暂无关联路线';
  const ratingText = place.amapRating ? `${html(place.amapRating.score)}/5` : '暂无评分';
  $('#detail-content').innerHTML = `<div class="detail-inner">
    <div class="detail-overline">地点 · ${html(place.district)} · ${html(place.category)}</div><h2>${html(place.name)}</h2>
    <div class="tag-row">${(place.tags || [place.category]).map((tag) => `<span class="detail-tag">${html(tag)}</span>`).join('')}</div>
    <p class="detail-description">${html(place.description || place.see)}</p>
    <div class="detail-facts">
      <div><small>建议停留</small><b>${html(place.stay)} 分钟</b></div>
      <div><small>高德评分</small><b>${ratingText}</b></div>
      <div><small>推荐指数</small><b class="editor-score">★ ${html(place.recommendIndex)}/5</b></div>
      <div><small>位置类型</small><b>${place.coordinatePrecision === 'poi' ? '高德地点' : '沿线代表点'}</b></div>
    </div>
    <p class="rating-note">高德评分来自对应地点的 POI，核对于 ${html(place.amapRating?.checkedAt || place.checkedAt)}；推荐指数是本站编辑判断，两者含义不同。</p>
    <section class="detail-section"><h3>这里有什么</h3><p>${html(place.see)}</p></section>
    <section class="detail-section"><h3>为什么推荐</h3><p>${html(place.why)}</p></section>
    ${place.coordinateNote ? `<section class="detail-section"><h3>坐标说明</h3><p class="accuracy-note">${html(place.coordinateNote)}</p></section>` : ''}
    <section class="detail-section"><h3>经过这里的路线</h3><div class="related-routes">${routeLinks}</div></section>
    <section class="detail-section"><h3>资料来源</h3>${sourceMarkup(place.sources)}<p style="margin-top:8px">核对日期：${html(place.checkedAt)}</p></section>
  </div>`;
}

function select(kind, id, options = {}) {
  const item = (kind === 'route' ? state.routes : state.places).find((entry) => entry.id === id);
  if (!item) return;
  state.selected = { kind, id };
  if (kind === 'route') renderRouteDetail(item); else renderPlaceDetail(item);
  $('#detail').hidden = false;
  $('#map-context').textContent = item.name;
  renderList();
  state.map?.select(kind, item);
  if (isMobile()) $('.sidebar').classList.remove('open');
  if (options.updateHash !== false) history.replaceState(null, '', `#${kind}/${encodeURIComponent(id)}`);
}

function closeDetail() {
  state.selected = null;
  $('#detail').hidden = true;
  $('#map-context').textContent = '杭州 · 探索地图';
  state.map?.clearSelection();
  renderList();
  history.replaceState(null, '', location.pathname + location.search);
}

function setupEvents() {
  $('#tab-routes').addEventListener('click', () => setTab('routes'));
  $('#tab-places').addEventListener('click', () => setTab('places'));
  $('#search').addEventListener('input', (event) => { state.query = event.target.value; renderList(); });
  $('#filters').addEventListener('click', (event) => { const button = event.target.closest('[data-filter]'); if (!button) return; if (state.selected) closeDetail(); state.placeTag = button.dataset.filter; renderFilters(); renderList(); refreshMap(); });
  $('#route-types').addEventListener('click', (event) => { const button = event.target.closest('[data-route-type]'); if (!button) return; if (state.selected) closeDetail(); state.routeType = button.dataset.routeType; renderFilters(); renderList(); refreshMap(); });
  $('#district-filter').addEventListener('change', (event) => { if (state.selected) closeDetail(); state.district = event.target.value; renderList(); refreshMap(); });
  $('#item-list').addEventListener('click', (event) => { const button = event.target.closest('[data-kind]'); if (button) select(button.dataset.kind, button.dataset.id); });
  $('.sidebar').addEventListener('wheel', (event) => {
    if (isMobile()) return;
    if (event.deltaY > 0) $('.sidebar').classList.add('compact');
    if (event.deltaY < 0 && $('#item-list').scrollTop === 0) $('.sidebar').classList.remove('compact');
  }, { passive: true });
  $('#detail').addEventListener('click', (event) => { const stop = event.target.closest('[data-stop]'); const route = event.target.closest('[data-route-link]'); if (stop) select('place', stop.dataset.stop); if (route) select('route', route.dataset.routeLink); });
  $('#close-detail').addEventListener('click', closeDetail);
  $('#reset-map').addEventListener('click', () => { closeDetail(); state.map?.reset(); });
  $('#mobile-list-toggle').addEventListener('click', () => $('.sidebar').classList.add('open'));
  $('.brand').addEventListener('click', () => { if (isMobile()) $('.sidebar').classList.toggle('open'); });
  document.addEventListener('keydown', (event) => { if (event.key === '/' && document.activeElement?.tagName !== 'INPUT') { event.preventDefault(); $('#search').focus(); if (isMobile()) $('.sidebar').classList.add('open'); } if (event.key === 'Escape' && state.selected) closeDetail(); });
}

function markerHtml(label, place, active = false) { return `<div class="map-marker-inner marker-${markerGroup(place)} ${active ? 'active' : ''}">${html(label)}</div>`; }
function gcjToWgs(coord) {
  const [lon, lat] = coord;
  const x = lon - 105, y = lat - 35;
  const transformLat = (x, y) => { let v = -100 + 2*x + 3*y + .2*y*y + .1*x*y + .2*Math.sqrt(Math.abs(x)); v += (20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3; v += (20*Math.sin(y*Math.PI)+40*Math.sin(y/3*Math.PI))*2/3; v += (160*Math.sin(y/12*Math.PI)+320*Math.sin(y*Math.PI/30))*2/3; return v; };
  const transformLon = (x, y) => { let v = 300 + x + 2*y + .1*x*x + .1*x*y + .1*Math.sqrt(Math.abs(x)); v += (20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3; v += (20*Math.sin(x*Math.PI)+40*Math.sin(x/3*Math.PI))*2/3; v += (150*Math.sin(x/12*Math.PI)+300*Math.sin(x/30*Math.PI))*2/3; return v; };
  const radLat = lat / 180 * Math.PI, magic = 1 - .006693421622965943 * Math.sin(radLat) ** 2;
  const dLat = transformLat(x, y) * 180 / ((6335552.717000426 / (magic * Math.sqrt(magic))) * Math.PI);
  const dLon = transformLon(x, y) * 180 / ((6378245 / Math.sqrt(magic)) * Math.cos(radLat) * Math.PI);
  return [lon - dLon, lat - dLat];
}

function createLeafletMap() {
  if (!window.L) throw new Error('Leaflet unavailable');
  const map = L.map('map', { zoomControl: false }).setView([30.252, 120.149], 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  L.control.zoom({ position: 'topright' }).addTo(map);
  const allLines = state.routes.map((route) => {
    const line = L.polyline(route.path.map((coord) => gcjToWgs(coord).reverse()), { color: routeColor(route), weight: 3, opacity: .64 }).addTo(map);
    line.on('click', () => select('route', route.id));
    return { id: route.id, line };
  });
  const markers = state.places.map((place) => {
    const [lon, lat] = gcjToWgs(place.coord);
    const marker = L.marker([lat, lon], { icon: L.divIcon({ className: 'map-marker', html: markerHtml('•', place), iconSize: [26, 26], iconAnchor: [13, 13] }) }).addTo(map);
    marker.on('click', () => select('place', place.id));
    marker.bindTooltip(place.name, { direction: 'top', offset: [0, -10] });
    return { id: place.id, marker, place };
  });
  let activeLine = null;
  return {
    reset() { map.setView([30.252, 120.149], 10); },
    setVisible(placeIds, routeIds) {
      markers.forEach(({ id, marker }) => { if (placeIds.has(id)) marker.addTo(map); else map.removeLayer(marker); });
      allLines.forEach(({ id, line }) => { if (routeIds.has(id)) line.addTo(map); else map.removeLayer(line); });
    },
    focusPlaces(places) {
      if (!places.length) return;
      const bounds = L.latLngBounds(places.map((place) => { const [lon, lat] = gcjToWgs(place.coord); return [lat, lon]; }));
      map.fitBounds(bounds, { padding: [55, 55], maxZoom: places.length === 1 ? 15 : 12 });
    },
    select(kind, item) {
      if (activeLine) { map.removeLayer(activeLine); activeLine = null; }
      markers.forEach(({ id, marker, place }) => marker.setIcon(L.divIcon({ className: 'map-marker', html: markerHtml('•', place, kind === 'place' && id === item.id), iconSize: [26, 26], iconAnchor: [13, 13] })));
      allLines.forEach(({ line }) => line.setStyle({ opacity: kind === 'route' ? .18 : .55 }));
      if (kind === 'route') {
        activeLine = L.polyline(item.path.map((coord) => gcjToWgs(coord).reverse()), { color: routeColor(item), weight: 5, opacity: 1 }).addTo(map);
        const bounds = activeLine.getBounds();
        map.fitBounds(bounds, { paddingTopLeft: [45, 45], paddingBottomRight: [45, 45], maxZoom: 15 });
        item.stops.forEach((id, index) => { const entry = markers.find((m) => m.id === id); if (entry) entry.marker.setIcon(L.divIcon({ className: 'map-marker', html: markerHtml(index + 1, entry.place, true), iconSize: [26, 26], iconAnchor: [13, 13] })); });
      } else { const [lon, lat] = gcjToWgs(item.coord); map.setView([lat, lon], 16); }
    },
    clearSelection() { if (activeLine) map.removeLayer(activeLine); activeLine = null; allLines.forEach(({ line }) => line.setStyle({ opacity: .64 })); markers.forEach(({ marker, place }) => marker.setIcon(L.divIcon({ className: 'map-marker', html: markerHtml('•', place), iconSize: [26, 26], iconAnchor: [13, 13] }))); },
    resize() { map.invalidateSize(); }
  };
}

async function createAmapMap(config) {
  window._AMapSecurityConfig = { serviceHost: config.amapProxyUrl };
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = setTimeout(() => reject(new Error('AMap timeout')), 12000);
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(config.amapJsKey)}`;
    script.onload = () => { clearTimeout(timeout); window.AMap ? resolve() : reject(new Error('AMap unavailable')); };
    script.onerror = () => { clearTimeout(timeout); reject(new Error('AMap script failed')); };
    document.head.appendChild(script);
  });
  const map = new AMap.Map('map', { center: [120.149, 30.252], zoom: 10, viewMode: '2D', mapStyle: 'amap://styles/normal' });
  const allLines = state.routes.map((route) => {
    const line = new AMap.Polyline({ path: route.path, strokeColor: routeColor(route), strokeWeight: 3, strokeOpacity: .64, map });
    line.on('click', () => select('route', route.id));
    return { id: route.id, line };
  });
  const markers = state.places.map((place) => {
    const marker = new AMap.Marker({ position: place.coord, content: `<div class="atlas-marker" title="${html(place.name)}">${markerHtml('•', place)}</div>`, offset: new AMap.Pixel(-13, -13), map, title: place.name });
    marker.on('click', () => select('place', place.id));
    return { id: place.id, marker, place };
  });
  let activeLine = null;
  return {
    reset() { map.setZoomAndCenter(10, [120.149, 30.252]); },
    setVisible(placeIds, routeIds) {
      markers.forEach(({ id, marker }) => marker.setMap(placeIds.has(id) ? map : null));
      allLines.forEach(({ id, line }) => line.setMap(routeIds.has(id) ? map : null));
    },
    focusPlaces(places) {
      if (!places.length) return;
      if (places.length === 1) { map.setZoomAndCenter(15, places[0].coord); return; }
      const ids = new Set(places.map((place) => place.id));
      map.setFitView(markers.filter(({ id }) => ids.has(id)).map(({ marker }) => marker), false, [55, 55, 55, 55], 12);
    },
    select(kind, item) {
      if (activeLine) { map.remove(activeLine); activeLine = null; }
      markers.forEach(({ id, marker, place }) => marker.setContent(`<div class="atlas-marker" title="${html(place.name)}">${markerHtml('•', place, kind === 'place' && id === item.id)}</div>`));
      allLines.forEach(({ line }) => line.setOptions({ strokeOpacity: kind === 'route' ? .18 : .55 }));
      if (kind === 'route') {
        activeLine = new AMap.Polyline({ path: item.path, strokeColor: routeColor(item), strokeWeight: 5, strokeOpacity: 1, map });
        map.setFitView([activeLine], false, [55, 55, 55, 55], 15);
        item.stops.forEach((id, index) => { const entry = markers.find((m) => m.id === id); if (entry) entry.marker.setContent(`<div class="atlas-marker" title="${html(entry.place.name)}">${markerHtml(index + 1, entry.place, true)}</div>`); });
      } else map.setZoomAndCenter(16, item.coord);
    },
    clearSelection() { if (activeLine) map.remove(activeLine); activeLine = null; allLines.forEach(({ line }) => line.setOptions({ strokeOpacity: .64 })); markers.forEach(({ marker, place }) => marker.setContent(`<div class="atlas-marker" title="${html(place.name)}">${markerHtml('•', place)}</div>`)); },
    resize() { map.resize(); }
  };
}

async function initMap() {
  const config = window.HZ_ATLAS_CONFIG || {};
  if (config.amapJsKey && config.amapProxyUrl) {
    try {
      state.map = await createAmapMap(config);
      state.provider = '高德地图';
      $('#map-provider').textContent = '底图：高德地图';
      return;
    } catch (error) { console.warn('高德地图载入失败，切换备用底图', error); $('#map').replaceChildren(); }
  }
  try {
    state.map = createLeafletMap();
    state.provider = 'OpenStreetMap';
    $('#map-provider').textContent = '备用底图：OpenStreetMap';
  } catch (error) { console.error(error); $('#map-error').hidden = false; $('#map-provider').textContent = '地图不可用'; }
}

async function main() {
  setupEvents();
  try {
    const [placesResponse, routesResponse] = await Promise.all([fetch('./data/places.json'), fetch('./data/routes.json')]);
    if (!placesResponse.ok || !routesResponse.ok) throw new Error('data unavailable');
    [state.places, state.routes] = await Promise.all([placesResponse.json(), routesResponse.json()]);
    $('#route-count').textContent = state.routes.length;
    $('#place-count').textContent = state.places.length;
    $('#route-tab-count').textContent = state.routes.length;
    $('#place-tab-count').textContent = state.places.length;
    renderFilters(); renderList();
    await initMap();
    refreshMap();
    const match = location.hash.match(/^#(route|place)\/(.+)$/);
    if (match) select(match[1], decodeURIComponent(match[2]), { updateHash: false });
    window.addEventListener('resize', () => state.map?.resize());
  } catch (error) {
    console.error(error);
    $('#item-list').innerHTML = '<div class="empty-state">数据载入失败。请通过本地预览服务器打开页面。</div>';
    $('#map-error').hidden = false;
  }
}
main();
