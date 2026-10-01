(function () {
  const STORAGE_KEY = 'hz-atlas-user-state:v1';
  const SESSION_KEY = 'hz-atlas-sync-session:v1';
  const EMPTY_MARK = () => ({ favorite: false, wantToGo: false, visited: false, visitedAt: null, updatedAt: Date.now() });
  const keyOf = (type, id) => `${type}:${id}`;
  const validType = (type) => type === 'place' || type === 'route';

  function cleanMark(value) {
    if (!value || typeof value !== 'object') return null;
    const visited = value.visited === true;
    return {
      favorite: value.favorite === true,
      wantToGo: value.wantToGo === true && !visited,
      visited,
      visitedAt: visited && Number.isSafeInteger(value.visitedAt) ? value.visitedAt : (visited ? Date.now() : null),
      updatedAt: Number.isSafeInteger(value.updatedAt) ? value.updatedAt : Date.now()
    };
  }

  function hasState(mark) {
    return Boolean(mark && (mark.favorite || mark.wantToGo || mark.visited));
  }

  function mergeMark(local, cloud) {
    const left = cleanMark(local);
    const right = cleanMark(cloud);
    if (!left && right) return right;
    if (left && !right) return left;
    if (!left && !right) return EMPTY_MARK();
    const visited = left.visited || right.visited;
    const visitDates = [left.visitedAt, right.visitedAt].filter(Number.isSafeInteger);
    return {
      favorite: left.favorite || right.favorite,
      wantToGo: !visited && (left.wantToGo || right.wantToGo),
      visited,
      visitedAt: visited ? (visitDates.length ? Math.min(...visitDates) : Date.now()) : null,
      updatedAt: Math.max(left.updatedAt, right.updatedAt)
    };
  }

  function safeLoad(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value && typeof value === 'object' ? value : fallback;
    } catch { return fallback; }
  }

  class UserStateStore {
    constructor() {
      const raw = safeLoad(STORAGE_KEY, {});
      this.data = { version: 1, marks: {}, pending: {}, ownerUserId: raw.ownerUserId || null };
      if (raw.version === 1 && raw.marks && typeof raw.marks === 'object') {
        for (const [key, value] of Object.entries(raw.marks)) {
          const [type, ...idParts] = key.split(':');
          const mark = cleanMark(value);
          if (validType(type) && idParts.join(':') && mark && hasState(mark)) this.data.marks[key] = mark;
        }
      }
      if (raw.version === 1 && raw.pending && typeof raw.pending === 'object') {
        for (const [key, value] of Object.entries(raw.pending)) {
          const [type, ...idParts] = key.split(':');
          if (!validType(type) || !idParts.join(':')) continue;
          this.data.pending[key] = value === null ? null : cleanMark(value);
        }
      }
      this.session = safeLoad(SESSION_KEY, null);
      if (!this.session?.token || !this.session?.user?.id) this.session = null;
      this.syncStatus = this.session ? 'checking' : 'local';
      this.listeners = new Set();
      this.persist();
    }

    subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    emit() { for (const listener of this.listeners) listener(); }
    persist() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); }
      catch { this.syncStatus = this.session ? 'error' : 'local'; }
    }
    apiBase() { return String(window.HZ_ATLAS_CONFIG?.userApiUrl || '').trim().replace(/\/+$/, ''); }
    isConfigured() { return Boolean(this.apiBase()); }
    getSession() { return this.session; }
    getOwnerUserId() { return this.data.ownerUserId; }
    getSyncStatus() { return this.syncStatus; }
    getMark(type, id) { return this.data.marks[keyOf(type, id)] || EMPTY_MARK(); }
    getAllMarks() {
      return Object.entries(this.data.marks).map(([key, mark]) => {
        const [entityType, ...parts] = key.split(':');
        return { entityType, entityId: parts.join(':'), ...mark };
      });
    }
    getCounts() {
      const marks = Object.values(this.data.marks);
      return {
        visited: marks.filter((mark) => mark.visited).length,
        wantToGo: marks.filter((mark) => mark.wantToGo).length,
        favorite: marks.filter((mark) => mark.favorite).length
      };
    }

    setStatus(type, id, status, enabled) {
      if (!validType(type) || !['favorite', 'wantToGo', 'visited'].includes(status)) return;
      const key = keyOf(type, id);
      const mark = { ...this.getMark(type, id), updatedAt: Date.now() };
      mark[status] = Boolean(enabled);
      if (status === 'visited') {
        mark.visitedAt = enabled ? (mark.visitedAt || Date.now()) : null;
        if (enabled) mark.wantToGo = false;
      } else if (status === 'wantToGo' && enabled) {
        mark.visited = false;
        mark.visitedAt = null;
      }
      if (!hasState(mark)) {
        delete this.data.marks[key];
        if (this.session) this.data.pending[key] = null;
        else delete this.data.pending[key];
      } else {
        this.data.marks[key] = mark;
        if (this.session) this.data.pending[key] = mark;
      }
      this.persist();
      this.emit();
      if (this.session) void this.pushOne(key);
    }

    async request(path, options = {}, token = this.session?.token) {
      const base = this.apiBase();
      if (!base) throw new Error('尚未配置云同步 Worker 地址。');
      const headers = new Headers(options.headers || {});
      if (token) headers.set('Authorization', `Bearer ${token}`);
      if (options.body) headers.set('Content-Type', 'application/json');
      let response;
      try {
        response = await fetch(`${base}${path}`, { ...options, headers, cache: 'no-store', signal: AbortSignal.timeout(10000) });
      } catch { throw new Error('无法连接云同步服务。'); }
      let payload = {};
      try { payload = await response.json(); } catch {}
      if (!response.ok) throw Object.assign(new Error(payload.error || '云同步请求失败。'), { status: response.status });
      return payload;
    }

    async initialize() {
      if (!this.session) { this.syncStatus = 'local'; this.emit(); return; }
      try {
        const payload = await this.request('/api/auth/me');
        this.session.user = payload.user;
        this.saveSession();
        await this.sync();
      } catch (error) {
        if (error.status === 401) {
          this.clearSession(false);
          this.syncStatus = 'local';
        } else this.syncStatus = 'error';
        this.emit();
      }
    }

    saveSession() {
      try { localStorage.setItem(SESSION_KEY, JSON.stringify(this.session)); }
      catch { this.syncStatus = 'error'; }
    }

    async register(username, password, mergeForeign) {
      const payload = await this.request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }, null);
      await this.connect(payload, mergeForeign);
    }

    async login(username, password, mergeForeign) {
      const payload = await this.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }, null);
      await this.connect(payload, mergeForeign);
    }

    async connect(payload, mergeForeign) {
      const cloud = await this.request('/api/marks', {}, payload.token);
      const cloudMap = {};
      for (const item of cloud.marks || []) {
        if (!validType(item.entityType) || typeof item.entityId !== 'string') continue;
        const mark = cleanMark(item);
        if (mark && hasState(mark)) cloudMap[keyOf(item.entityType, item.entityId)] = mark;
      }
      const foreignOwner = this.data.ownerUserId && this.data.ownerUserId !== payload.user.id;
      const shouldMerge = !foreignOwner || await mergeForeign();
      const localMap = shouldMerge ? this.data.marks : {};
      const pending = shouldMerge ? this.data.pending : {};
      const merged = { ...cloudMap };
      if (shouldMerge) {
        for (const [key, mark] of Object.entries(localMap)) {
          if (Object.hasOwn(pending, key)) {
            if (pending[key]) merged[key] = pending[key];
            else delete merged[key];
          } else merged[key] = mergeMark(mark, cloudMap[key]);
        }
        for (const [key, mark] of Object.entries(pending)) {
          if (mark) merged[key] = mark;
          else delete merged[key];
        }
      }
      this.session = { token: payload.token, expiresAt: payload.expiresAt, user: payload.user };
      this.data.marks = merged;
      this.data.ownerUserId = payload.user.id;
      this.data.pending = {};
      this.persist();
      this.saveSession();
      this.syncStatus = 'syncing';
      this.emit();
      const writes = [];
      if (shouldMerge) {
        const keys = new Set([...Object.keys(localMap), ...Object.keys(pending)]);
        for (const key of keys) {
          const mark = merged[key];
          if (mark && JSON.stringify(mark) !== JSON.stringify(cloudMap[key])) writes.push(this.putKey(key, mark));
          else if (!mark && cloudMap[key]) writes.push(this.deleteKey(key));
        }
      }
      try {
        await Promise.all(writes);
        this.syncStatus = 'synced';
      } catch {
        this.syncStatus = 'error';
        for (const key of new Set([...Object.keys(localMap), ...Object.keys(pending)])) {
          this.data.pending[key] = merged[key] || null;
        }
        this.persist();
      }
      this.emit();
    }

    async sync() {
      if (!this.session) return;
      this.syncStatus = 'syncing';
      this.emit();
      try {
        const payload = await this.request('/api/marks');
        const cloud = {};
        for (const item of payload.marks || []) {
          if (!validType(item.entityType) || typeof item.entityId !== 'string') continue;
          const mark = cleanMark(item);
          if (mark && hasState(mark)) cloud[keyOf(item.entityType, item.entityId)] = mark;
        }
        const merged = { ...cloud };
        for (const [key, local] of Object.entries(this.data.marks)) {
          if (Object.hasOwn(this.data.pending, key)) {
            const pending = this.data.pending[key];
            if (pending) merged[key] = pending;
            else delete merged[key];
          } else merged[key] = mergeMark(local, cloud[key]);
        }
        for (const [key, pending] of Object.entries(this.data.pending)) {
          if (pending) merged[key] = pending;
          else delete merged[key];
        }
        this.data.marks = merged;
        this.persist();

        const writes = [];
        const keys = new Set([...Object.keys(this.data.pending), ...Object.keys(this.data.marks)]);
        for (const key of keys) {
          const local = this.data.marks[key];
          if (local && JSON.stringify(local) !== JSON.stringify(cloud[key])) writes.push(this.putKey(key, local));
          else if (!local && cloud[key]) writes.push(this.deleteKey(key));
        }
        await Promise.all(writes);
        this.data.pending = {};
        this.data.ownerUserId = this.session.user.id;
        this.persist();
        this.syncStatus = 'synced';
      } catch (error) {
        if (error.status === 401) {
          this.clearSession(false);
          this.syncStatus = 'local';
        } else {
          this.syncStatus = 'error';
          window.dispatchEvent(new CustomEvent('atlas-sync-error'));
        }
      }
      this.emit();
    }

    async putKey(key, mark) {
      const [type, ...parts] = key.split(':');
      return this.request(`/api/marks/${type}/${encodeURIComponent(parts.join(':'))}`, {
        method: 'PUT', body: JSON.stringify(mark)
      });
    }

    async deleteKey(key) { return this.putKey(key, EMPTY_MARK()); }

    async pushOne(key) {
      if (!this.session) return;
      try {
        const pending = this.data.pending[key];
        if (pending) await this.putKey(key, pending);
        else await this.deleteKey(key);
        delete this.data.pending[key];
        this.persist();
        this.syncStatus = Object.keys(this.data.pending).length ? 'pending' : 'synced';
      } catch (error) {
        if (error.status === 401) this.clearSession(false);
        else {
          this.syncStatus = 'error';
          window.dispatchEvent(new CustomEvent('atlas-sync-error'));
        }
      }
      this.emit();
    }

    async logout() {
      if (this.session) {
        try { await this.request('/api/auth/logout', { method: 'POST', body: '{}' }); } catch {}
      }
      this.clearSession(true);
    }

    clearSession(keepMarks) {
      this.session = null;
      try { localStorage.removeItem(SESSION_KEY); } catch {}
      this.syncStatus = 'local';
      this.persist();
      this.emit();
    }

    exportData() {
      return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), marks: this.data.marks }, null, 2);
    }

    async importData(value) {
      if (!value || value.version !== 1 || !value.marks || typeof value.marks !== 'object') throw new Error('备份文件格式不正确。');
      const imported = {};
      for (const [key, value] of Object.entries(value.marks)) {
        const [type, ...parts] = key.split(':');
        const mark = cleanMark(value);
        if (validType(type) && parts.join(':') && mark && hasState(mark)) imported[key] = mark;
      }
      for (const [key, mark] of Object.entries(imported)) {
        this.data.marks[key] = mergeMark(this.data.marks[key], mark);
        if (this.session) this.data.pending[key] = this.data.marks[key];
      }
      this.persist();
      this.emit();
      if (this.session) await this.sync();
    }
  }

  window.HZAtlasUserState = new UserStateStore();
})();
