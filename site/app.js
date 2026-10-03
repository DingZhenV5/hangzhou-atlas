const $ = (selector) => document.querySelector(selector);
const html = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const UserState = window.HZAtlasUserState;
const state = { places: [], routes: [], tab: 'routes', routeType: '全部', placeTags: new Set(), district: '全部', difficultyMin: 1, difficultyMax: 5, query: '', selected: null, map: null, provider: '', myMode: false, myFilter: 'visited' };
const placeById = () => new Map(state.places.map((place) => [place.id, place]));
const isSheetViewport = () => matchMedia('(max-width: 900px)').matches;
const mobileViewportHeight = () => window.visualViewport?.height || window.innerHeight;
const difficultyLabels = ['', '轻松', '入门', '中等', '进阶', '较难'];
function routeDifficultyLevel(route) {
  const difficulty = String(route.difficulty || '').replace(/\s+/g, '');
  if (/偏难|较难|挑战|困难|高强度/.test(difficulty)) return 5;
  if (/进阶/.test(difficulty)) return 4;
  if (/中等/.test(difficulty)) return 3;
  if (/入门|上坡/.test(difficulty)) return 2;
  if (/轻松|步行|参观|休闲/.test(difficulty)) return 1;
  return 3;
}
function setMobileSheetHeight(height) {
  if (!isSheetViewport()) return;
  const viewport = mobileViewportHeight();
  const minimum = Math.round(viewport * 0.25);
  const maximum = Math.round(viewport * 0.88);
  const nextHeight = Math.max(minimum, Math.min(maximum, Math.round(height)));
  document.documentElement.style.setProperty('--mobile-sheet-height', `${nextHeight}px`);
  const collapsed = nextHeight <= minimum + 8;
  $('.sidebar').classList.toggle('sheet-collapsed', collapsed);
  $('#mobile-sheet-label').textContent = collapsed ? '拖动调整 · 点按展开' : '拖动调整 · 点按收起';
  $('#mobile-sheet-handle').setAttribute('aria-expanded', String(!collapsed));
}
function toggleMobileSheet() {
  if (!isSheetViewport()) return;
  const current = $('.sidebar').getBoundingClientRect().height;
  const viewport = mobileViewportHeight();
  setMobileSheetHeight(current < viewport * 0.45 ? viewport * 0.68 : viewport * 0.25);
}
const routeColor = (route) => route.type === '徒步' ? '#478562' : '#d48b52';
const markerGroup = (place) => {
  if (place.tags?.includes('博物馆') || place.tags?.includes('科技馆')) return 'museum';
  if (place.tags?.includes('商场') || place.tags?.includes('商业街')) return 'shopping';
  if (place.tags?.includes('游玩')) return 'fun';
  if (place.tags?.some((tag) => ['古迹', '历史街区', '遗址公园'].includes(tag))) return 'heritage';
  return 'nature';
};
const selectedPlaces = () => state.places.filter((place) => (!state.placeTags.size || [...state.placeTags].some((tag) => place.tags?.includes(tag))) && (state.district === '全部' || place.district === state.district));
const selectedPlaceIds = () => new Set(selectedPlaces().map((place) => place.id));
const selectedRoutes = () => {
  if (state.tab === 'routes') {
    const districtPlaceIds = state.district === '全部' ? null : new Set(state.places.filter((place) => place.district === state.district).map((place) => place.id));
    return state.routes.filter((route) => (state.routeType === '全部' || route.type === state.routeType) && routeDifficultyLevel(route) >= state.difficultyMin && routeDifficultyLevel(route) <= state.difficultyMax && (!districtPlaceIds || route.stops.some((id) => districtPlaceIds.has(id))));
  }
  const ids = selectedPlaceIds();
  return state.routes.filter((route) => route.stops.some((id) => ids.has(id)));
};
function refreshMap() {
  if (state.myMode) {
    const ids = new Set(UserState.getAllMarks().filter((mark) => mark[state.myFilter]).map((mark) => `${mark.entityType}:${mark.entityId}`));
    const routes = state.routes.filter((route) => ids.has(`route:${route.id}`));
    const places = state.places.filter((place) => ids.has(`place:${place.id}`));
    state.map?.setVisible(new Set(places.map((place) => place.id)), new Set(routes.map((route) => route.id)));
    if (places.length) state.map?.focusPlaces(places);
    else if (routes.length) state.map?.focusPlaces(routes.flatMap((route) => route.stops.map((id) => placeById().get(id))).filter(Boolean));
    else state.map?.reset();
    return;
  }
  const routes = selectedRoutes();
  const routeStopIds = new Set(routes.flatMap((route) => route.stops));
  const places = state.tab === 'routes' ? state.places.filter((place) => routeStopIds.has(place.id) && (state.district === '全部' || place.district === state.district)) : selectedPlaces();
  state.map?.setVisible(new Set(places.map((place) => place.id)), new Set(routes.map((route) => route.id)));
  if (state.district !== '全部' || (state.tab === 'places' && state.placeTags.size)) state.map?.focusPlaces(places);
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
  renderFilters();
  renderList();
}

function renderFilters() {
  const featuredTags = ['博物馆', '商场', '游玩', '自然风景', '历史街区', '古迹', '文创空间', '遗址公园'];
  const filters = featuredTags.filter((tag) => state.places.some((place) => place.tags?.includes(tag)));
  $('#filters').innerHTML = `<button class="filter ${state.placeTags.size ? '' : 'active'}" type="button" data-filter="全部" aria-pressed="${!state.placeTags.size}">全部</button>${filters.map((filter) => `<button class="filter ${state.placeTags.has(filter) ? 'active' : ''}" type="button" data-filter="${html(filter)}" aria-pressed="${state.placeTags.has(filter)}">${html(filter)}</button>`).join('')}`;
  $('#route-types').innerHTML = ['全部', '徒步', '逛玩'].map((type) => `<button class="filter ${type === state.routeType ? 'active' : ''}" type="button" data-route-type="${html(type)}" aria-pressed="${type === state.routeType}">${html(type === '全部' ? '全部路线' : type)}</button>`).join('');
  $('#filters').hidden = state.tab !== 'places';
  $('#route-types').hidden = state.tab !== 'routes';
  $('#route-difficulty').hidden = state.tab !== 'routes';
  updateDifficultyFilter();
  const districts = [...new Set(state.places.map((place) => place.district).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  $('#district-filter').innerHTML = `<option value="全部">全部区域</option>${districts.map((district) => `<option value="${html(district)}" ${district === state.district ? 'selected' : ''}>${html(district)}</option>`).join('')}`;
}

function updateDifficultyFilter() {
  const low = $('#difficulty-min'), high = $('#difficulty-max');
  low.value = state.difficultyMin;
  high.value = state.difficultyMax;
  low.setAttribute('aria-valuetext', difficultyLabels[state.difficultyMin]);
  high.setAttribute('aria-valuetext', difficultyLabels[state.difficultyMax]);
  $('#difficulty-value').textContent = state.difficultyMin === state.difficultyMax ? difficultyLabels[state.difficultyMin] : `${difficultyLabels[state.difficultyMin]} — ${difficultyLabels[state.difficultyMax]}`;
  $('#difficulty-sliders').style.setProperty('--range-start', `${(state.difficultyMin - 1) * 25}%`);
  document.getElementById('difficulty-sliders').classList.toggle('equal-range', state.difficultyMin === state.difficultyMax);
  $('#difficulty-sliders').style.setProperty('--range-end', `${(state.difficultyMax - 1) * 25}%`);
  low.style.zIndex = state.difficultyMin === state.difficultyMax ? '3' : '2';
  high.style.zIndex = state.difficultyMin === state.difficultyMax ? '2' : '3';
}

function placeDetailInMobileSheet() {
  const detail = $('#detail');
  const sidebar = $('.sidebar');
  const alreadyInSheet = detail.parentElement === sidebar;
  if (!alreadyInSheet) sidebar.insertBefore(detail, $('.sidebar-footer'));
  sidebar.classList.add('detail-open');
  if (!alreadyInSheet) setMobileSheetHeight(mobileViewportHeight() * 0.72);
}

function restoreDetailToShell() {
  const detail = $('#detail');
  const shell = $('.app-shell');
  if (detail.parentElement !== shell) shell.append(detail);
  $('.sidebar').classList.remove('detail-open');
}

function matchQuery(item, query) {
  if (!query) return true;
  const stops = item.stops?.map((id) => placeById().get(id)?.name).join(' ') || '';
  return [item.name, item.region, item.district, item.type, item.category, item.difficulty, ...(item.tags || []), item.summary, item.experience, item.see, item.description, stops].filter(Boolean).join(' ').toLocaleLowerCase().includes(query);
}

function renderList() {
  const query = state.query.trim().toLocaleLowerCase();
  if (state.myMode) {
    const filter = state.myFilter;
    const items = [
      ...state.routes.map((item) => ({ kind: 'route', item })),
      ...state.places.map((item) => ({ kind: 'place', item }))
    ].filter(({ kind, item }) => UserState.getMark(kind, item.id)[filter] && matchQuery(item, query));
    $('#list-title').textContent = ({ visited: '去过的路线与地点', wantToGo: '想去的路线与地点', favorite: '收藏的路线与地点' })[filter];
    $('#result-count').textContent = `${items.length} 条记录`;
    $('#item-list').innerHTML = items.length ? items.map(({ kind, item }) => myItemRow(kind, item)).join('') : '<div class="empty-state">这里还没有记录。浏览路线和地点时，可以点按“收藏”“想去”或“去过”。</div>';
    return;
  }
  const items = state.tab === 'routes' ? selectedRoutes() : selectedPlaces();
  const filtered = items.filter((item) => matchQuery(item, query));
  $('#result-count').textContent = `${filtered.length} 个结果`;
  $('#item-list').innerHTML = filtered.length ? filtered.map((item) => state.tab === 'routes' ? routeCard(item) : placeCard(item)).join('') : '<div class="empty-state">没有找到匹配内容。试试其他关键词或筛选条件。</div>';
}

function routeCard(route) {
  const selected = state.selected?.kind === 'route' && state.selected.id === route.id;
  const typeClass = route.type === '徒步' ? 'hike' : 'walk';
  return `<div class="item-row"><button class="item-card ${selected ? 'selected' : ''}" type="button" data-kind="route" data-id="${html(route.id)}"><div class="card-kicker"><span class="pill ${typeClass}">${html(route.type)}</span><span>NO. ${String(route.order).padStart(2, '0')} · ${html(route.region)}</span></div><div class="card-title">${html(route.name)}</div><p class="card-summary">${html(route.summary)}</p><div class="card-meta"><span>${html(route.duration)}</span><span>${html(route.distance)}</span><span>难度 ${html(route.difficulty)}</span><span class="editor-score">推荐 ${html(route.recommendIndex)}/5</span></div></button>${renderMarkActions('route', route.id)}</div>`;
}

function placeCard(place) {
  const selected = state.selected?.kind === 'place' && state.selected.id === place.id;
  return `<div class="item-row"><button class="item-card ${selected ? 'selected' : ''}" type="button" data-kind="place" data-id="${html(place.id)}"><div class="card-kicker"><span class="pill place-${markerGroup(place)}">${html(place.category)}</span><span>${html(place.district)} · 高德 ${place.amapRating ? html(place.amapRating.score) + '/5' : '暂无评分'}</span></div><div class="card-title">${html(place.name)}</div><p class="card-summary">${html(place.description || place.see)}</p><div class="card-meta"><span>停留 ${html(place.stay)} 分钟</span><span class="editor-score">推荐 ${html(place.recommendIndex)}/5</span></div></button>${renderMarkActions('place', place.id)}</div>`;
}

function renderMarkActions(kind, id, detail = false) {
  const mark = UserState.getMark(kind, id);
  const controls = [
    ['favorite', '♡ 收藏', '♥ 已收藏'],
    ['wantToGo', '＋ 想去', '✓ 想去'],
    ['visited', '○ 去过', '✓ 去过']
  ];
  return `<div class="${detail ? 'detail-mark-actions' : 'mark-actions'}" aria-label="个人状态">${controls.map(([key, off, on]) => `<button type="button" class="mark-action" data-mark-action="${key}" data-mark-type="${kind}" data-mark-id="${html(id)}" aria-pressed="${mark[key]}">${mark[key] ? on : off}</button>`).join('')}</div>`;
}

function myItemRow(kind, item) {
  const card = kind === 'route' ? routeCard(item) : placeCard(item);
  const label = kind === 'route' ? '路线' : '地点';
  return `<div class="my-item"><div class="my-item-label"><span>${label}</span><b>${html(item.region || item.district || '')}</b></div>${card}</div>`;
}

function renderMyToolbar() {
  $('#my-toolbar').hidden = !state.myMode;
  const counts = UserState.getCounts();
  $('#my-visited-count').textContent = counts.visited;
  $('#my-want-count').textContent = counts.wantToGo;
  $('#my-favorite-count').textContent = counts.favorite;
  $('#my-toolbar').querySelectorAll('[data-my-filter]').forEach((button) => {
    button.classList.toggle('active', button.dataset.myFilter === state.myFilter);
  });
  const session = UserState.getSession();
  const syncStatus = UserState.getSyncStatus();
  const descriptions = {
    local: '记录目前保存在此设备', checking: '正在检查同步状态…', syncing: '正在同步记录…',
    synced: `已同步 · ${session?.user?.username || '同步账号'}`, pending: '有记录等待同步', error: '本机已保存，云同步稍后重试'
  };
  $('#sync-state').textContent = descriptions[syncStatus] || descriptions.local;
  $('#sync-login').hidden = Boolean(session);
  $('#sync-register').hidden = Boolean(session);
  $('#sync-logout').hidden = !session;
}

function toggleMyMode() {
  if (!state.myMode && state.selected) closeDetail();
  if (!state.myMode) {
    const counts = UserState.getCounts();
    if (!counts[state.myFilter]) state.myFilter = counts.visited ? 'visited' : counts.wantToGo ? 'wantToGo' : counts.favorite ? 'favorite' : 'visited';
  }
  state.myMode = !state.myMode;
  $('.sidebar').classList.toggle('my-mode', state.myMode);
  $('#my-hangzhou-button').firstChild.textContent = state.myMode ? '返回地图 ' : '我的杭州 ';
  renderMyToolbar();
  renderList();
  refreshMap();
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
    <h2>${html(route.name)}</h2><p class="detail-description">${html(route.summary)}</p>${renderMarkActions('route', route.id, true)}
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
    <div class="detail-overline">地点 · ${html(place.district)} · ${html(place.category)}</div><h2>${html(place.name)}</h2>${renderMarkActions('place', place.id, true)}
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
  if (isSheetViewport()) placeDetailInMobileSheet();
  else restoreDetailToShell();
  $('#map-context').textContent = item.name;
  renderList();
  state.map?.select(kind, item);
  if (options.updateHash !== false) history.replaceState(null, '', `#${kind}/${encodeURIComponent(id)}`);
}

function closeDetail() {
  state.selected = null;
  $('#detail').hidden = true;
  restoreDetailToShell();
  $('#map-context').textContent = '杭州 · 探索地图';
  state.map?.clearSelection();
  renderList();
  history.replaceState(null, '', location.pathname + location.search);
}

function setupEvents() {
  $('#tab-routes').addEventListener('click', () => setTab('routes'));
  $('#tab-places').addEventListener('click', () => setTab('places'));
  $('#search').addEventListener('input', (event) => { state.query = event.target.value; renderList(); });
  $('#filters').addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    if (state.selected) closeDetail();
    const tag = button.dataset.filter;
    if (tag === '全部') state.placeTags.clear();
    else if (state.placeTags.has(tag)) state.placeTags.delete(tag);
    else state.placeTags.add(tag);
    renderFilters(); renderList(); refreshMap();
  });
  $('#route-types').addEventListener('click', (event) => { const button = event.target.closest('[data-route-type]'); if (!button) return; if (state.selected) closeDetail(); state.routeType = button.dataset.routeType; renderFilters(); renderList(); refreshMap(); });
  const onDifficultyInput = (event) => {
    const value = Number(event.target.value);
    if (event.target.id === 'difficulty-min') state.difficultyMin = Math.min(value, state.difficultyMax);
    else state.difficultyMax = Math.max(value, state.difficultyMin);
    if (state.selected) closeDetail();
    updateDifficultyFilter(); renderList(); refreshMap();
  };
  $('#difficulty-min').addEventListener('input', onDifficultyInput);
  $('#difficulty-max').addEventListener('input', onDifficultyInput);
  $('#district-filter').addEventListener('change', (event) => { if (state.selected) closeDetail(); state.district = event.target.value; renderList(); refreshMap(); });
  $('#item-list').addEventListener('click', (event) => {
    const mark = event.target.closest('[data-mark-action]');
    if (mark) { updateMarkFromControl(mark); return; }
    const button = event.target.closest('[data-kind]');
    if (button) select(button.dataset.kind, button.dataset.id);
  });
  $('.sidebar').addEventListener('wheel', (event) => {
    if (isSheetViewport()) return;
    if (event.deltaY > 0) $('.sidebar').classList.add('compact');
    if (event.deltaY < 0 && $('#item-list').scrollTop === 0) $('.sidebar').classList.remove('compact');
  }, { passive: true });
  $('#detail').addEventListener('click', (event) => {
    const mark = event.target.closest('[data-mark-action]');
    const stop = event.target.closest('[data-stop]');
    const route = event.target.closest('[data-route-link]');
    if (mark) { updateMarkFromControl(mark); return; }
    if (stop) select('place', stop.dataset.stop);
    if (route) select('route', route.dataset.routeLink);
  });
  $('#close-detail').addEventListener('click', closeDetail);
  const syncDetailPlacement = () => {
    if (!state.selected) { restoreDetailToShell(); return; }
    if (isSheetViewport()) placeDetailInMobileSheet();
    else restoreDetailToShell();
  };
  window.addEventListener('resize', syncDetailPlacement);
  window.visualViewport?.addEventListener('resize', syncDetailPlacement);
  $('#reset-map').addEventListener('click', () => { closeDetail(); state.map?.reset(); });
  $('#my-hangzhou-button').addEventListener('click', (event) => { event.stopPropagation(); toggleMyMode(); });
  $('#my-toolbar').addEventListener('click', (event) => {
    const filter = event.target.closest('[data-my-filter]');
    if (filter) { state.myFilter = filter.dataset.myFilter; renderMyToolbar(); renderList(); refreshMap(); }
  });
  $('#sync-login').addEventListener('click', () => openSyncDialog(false));
  $('#sync-register').addEventListener('click', () => openSyncDialog(true));
  $('#sync-logout').addEventListener('click', async () => {
    await UserState.logout();
    renderMyToolbar(); renderList();
    showToast('已退出同步；本机记录仍保留。');
  });
  $('#sync-dialog-close').addEventListener('click', () => $('#sync-dialog').close());
  $('#auth-mode-toggle').addEventListener('click', () => setAuthMode(!authMode.create));
  $('#sync-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = $('#sync-username').value;
    const password = $('#sync-password').value;
    const message = $('#auth-message');
    message.textContent = '';
    if (!UserState.isConfigured()) { message.textContent = '云同步 Worker 尚未配置，请先完成部署设置。'; return; }
    if (authMode.create && password !== $('#sync-password-confirm').value) { message.textContent = '两次输入的密码不一致。'; return; }
    const submit = $('#auth-submit');
    submit.disabled = true;
    submit.textContent = authMode.create ? '正在创建…' : '正在登录…';
    const mergeForeign = async () => {
      const ownerId = UserState.getOwnerUserId();
      const currentId = UserState.getSession()?.user?.id;
      if (!ownerId || ownerId === currentId) return true;
      return window.confirm('此设备保留着另一个同步账号的本地记录。选择“确定”会将这些记录合并到当前账号；选择“取消”只加载当前账号的云端记录。');
    };
    try {
      if (authMode.create) await UserState.register(username, password, mergeForeign);
      else await UserState.login(username, password, mergeForeign);
      $('#sync-dialog').close();
      renderMyToolbar(); renderList(); refreshMap();
      showToast(UserState.getSyncStatus() === 'error' ? '已登录，本机记录保留；云同步稍后重试。' : '同步账号已连接。');
    } catch (error) { message.textContent = error.message || '操作失败，请稍后重试。'; }
    finally { submit.disabled = false; submit.textContent = authMode.create ? '创建并同步' : '登录并同步'; }
  });
  $('#export-marks').addEventListener('click', () => {
    const blob = new Blob([UserState.exportData()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `hangzhou-atlas-marks-${new Date().toISOString().slice(0, 10)}.json`;
    link.click(); URL.revokeObjectURL(url);
    showToast('记录备份已导出。');
  });
  $('#import-marks').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      await UserState.importData(JSON.parse(text));
      renderMyToolbar(); renderList(); refreshMap();
      showToast('备份记录已合并。');
    } catch (error) { showToast(error.message || '无法导入这份备份。'); }
    event.target.value = '';
  });
  if (isSheetViewport()) setMobileSheetHeight(mobileViewportHeight() * 0.3);
  $('#mobile-list-toggle').addEventListener('click', () => setMobileSheetHeight(mobileViewportHeight() * 0.72));
  const sheetHandle = $('#mobile-sheet-handle');
  let sheetDrag = null;
  let ignoreSheetClick = false;
  sheetHandle.addEventListener('pointerdown', (event) => {
    if (!isSheetViewport()) return;
    sheetDrag = { pointerId: event.pointerId, startY: event.clientY, startHeight: $('.sidebar').getBoundingClientRect().height, moved: false };
    $('.sidebar').classList.add('resizing');
    sheetHandle.setPointerCapture(event.pointerId);
  });
  sheetHandle.addEventListener('pointermove', (event) => {
    if (!sheetDrag || event.pointerId !== sheetDrag.pointerId) return;
    const delta = sheetDrag.startY - event.clientY;
    if (Math.abs(delta) > 5) sheetDrag.moved = true;
    if (sheetDrag.moved) setMobileSheetHeight(sheetDrag.startHeight + delta);
  });
  const endSheetDrag = (event) => {
    if (!sheetDrag || event.pointerId !== sheetDrag.pointerId) return;
    const moved = sheetDrag.moved;
    sheetDrag = null;
    $('.sidebar').classList.remove('resizing');
    if (sheetHandle.hasPointerCapture(event.pointerId)) sheetHandle.releasePointerCapture(event.pointerId);
    if (moved) { ignoreSheetClick = true; setTimeout(() => { ignoreSheetClick = false; }, 0); }
  };
  sheetHandle.addEventListener('pointerup', endSheetDrag);
  sheetHandle.addEventListener('pointercancel', endSheetDrag);
  sheetHandle.addEventListener('click', () => { if (ignoreSheetClick) return; toggleMobileSheet(); });
  $('.brand').addEventListener('click', () => { if (isSheetViewport()) toggleMobileSheet(); });
  document.addEventListener('keydown', (event) => { if (event.key === '/' && document.activeElement?.tagName !== 'INPUT') { event.preventDefault(); $('#search').focus(); if (isSheetViewport()) setMobileSheetHeight(mobileViewportHeight() * 0.72); } if (event.key === 'Escape' && state.selected) closeDetail(); });
}

const authMode = { create: false };
function setAuthMode(create) {
  authMode.create = create;
  $('#sync-dialog-title').textContent = create ? '创建同步账号' : '同步我的记录';
  $('#auth-submit').textContent = create ? '创建并同步' : '登录并同步';
  $('#auth-mode-toggle').textContent = create ? '已有同步账号？返回登录' : '没有同步账号？创建一个';
  $('#confirm-password-wrap').hidden = !create;
  $('#sync-password-note').hidden = !create;
  $('#sync-password').autocomplete = create ? 'new-password' : 'current-password';
  $('#sync-password-confirm').required = create;
  $('#auth-message').textContent = '';
}

function openSyncDialog(create = false) {
  setAuthMode(create);
  $('#sync-username').value = '';
  $('#sync-password').value = '';
  $('#sync-password-confirm').value = '';
  $('#auth-submit').disabled = !UserState.isConfigured();
  if (!UserState.isConfigured()) $('#auth-message').textContent = '尚未配置云同步 Worker 地址。可先使用本机记录；部署步骤见项目 docs/USER-SYNC.md。';
  $('#sync-dialog').showModal();
}

function updateMarkFromControl(button) {
  const status = button.dataset.markAction;
  const enabled = button.getAttribute('aria-pressed') !== 'true';
  if (state.myMode && enabled) state.myFilter = status;
  UserState.setStatus(button.dataset.markType, button.dataset.markId, status, enabled);
}

let toastTimer;
function showToast(message) {
  const toast = $('#app-toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2800);
}

function refreshPersonalUI() {
  renderMyToolbar();
  renderList();
  document.querySelectorAll('[data-mark-action]').forEach((button) => {
    const active = UserState.getMark(button.dataset.markType, button.dataset.markId)[button.dataset.markAction];
    button.setAttribute('aria-pressed', String(active));
    const labels = { favorite: active ? '♥ 已收藏' : '♡ 收藏', wantToGo: active ? '✓ 想去' : '＋ 想去', visited: active ? '✓ 去过' : '○ 去过' };
    button.textContent = labels[button.dataset.markAction];
  });
  if (state.myMode) refreshMap();
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
  UserState.subscribe(refreshPersonalUI);
  renderMyToolbar();
  window.addEventListener('online', () => { if (UserState.getSession()) void UserState.sync(); });
  window.addEventListener('atlas-sync-error', () => showToast('已保存在本机，云同步稍后重试。'));
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
    requestAnimationFrame(() => state.map?.resize());
    setTimeout(() => state.map?.resize(), 250);
    refreshMap();
    const match = location.hash.match(/^#(route|place)\/(.+)$/);
    if (match) select(match[1], decodeURIComponent(match[2]), { updateHash: false });
    void UserState.initialize();
    window.addEventListener('resize', () => state.map?.resize());
    window.visualViewport?.addEventListener('resize', () => { setMobileSheetHeight($('.sidebar').getBoundingClientRect().height); state.map?.resize(); });
    window.addEventListener('orientationchange', () => setTimeout(() => { setMobileSheetHeight(mobileViewportHeight() * 0.3); state.map?.resize(); }, 180));
  } catch (error) {
    console.error(error);
    $('#item-list').innerHTML = '<div class="empty-state">数据载入失败。请通过本地预览服务器打开页面。</div>';
    $('#map-error').hidden = false;
  }
}
main();
