// テスト用の最小限の Firestore / Admin Auth の偽物（本番では使わない）。
// トランザクションは楽観ロック（読んだ文書・クエリ対象コレクションが変わっていたら再試行）で再現する。
const tick = () => new Promise((r) => setImmediate(r));

const INC = Symbol('increment');
const FieldValue = {
  increment: (n) => ({ [INC]: n }),
  serverTimestamp: () => ({ serverTimestamp: true })
};

function applyFields(base, data) {
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && INC in v) out[k] = (Number(out[k]) || 0) + v[INC];
    else out[k] = v;
  }
  return out;
}

class Snap {
  constructor(id, data) { this.id = id; this._d = data; this.exists = data !== undefined; }
  data() { return this._d ? { ...this._d } : undefined; }
  get(f) { return this._d ? this._d[f] : undefined; }
}

class FakeDB {
  constructor() { this.docs = new Map(); this.ver = new Map(); this.colVer = new Map(); this.seq = 0; this.writes = 0; }
  collection(name) { return new Col(this, name); }
  _get(path) { return this.docs.get(path); }
  _put(path, data) {
    this.writes++;
    const col = path.split('/')[0];
    if (data === undefined) this.docs.delete(path); else this.docs.set(path, data);
    this.ver.set(path, (this.ver.get(path) || 0) + 1);
    this.colVer.set(col, (this.colVer.get(col) || 0) + 1);
  }
  dump() { return JSON.stringify([...this.docs.entries()].sort()); }
  async runTransaction(fn) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const tx = new Tx(this);
      const result = await fn(tx); // fn の throw はそのまま外へ（本物と同じ）
      await tick();
      if (tx._valid()) { tx._commit(); return result; }
    }
    throw new Error('transaction contention');
  }
}

class Col {
  constructor(db, name) { this.db = db; this.name = name; this._where = []; this._limit = null; }
  doc(id) { return new DocRef(this.db, `${this.name}/${id}`, id); }
  where(f, op, v) { const c = new Col(this.db, this.name); c._where = [...this._where, [f, op, v]]; c._limit = this._limit; return c; }
  limit(n) { const c = new Col(this.db, this.name); c._where = this._where; c._limit = n; return c; }
  async add(data) { await tick(); const id = `auto${++this.db.seq}`; this.db._put(`${this.name}/${id}`, applyFields({}, data)); return this.doc(id); }
  _run() {
    let rows = [...this.db.docs.entries()]
      .filter(([p]) => p.startsWith(`${this.name}/`) && p.split('/').length === 2)
      .filter(([, d]) => this._where.every(([f, op, v]) => op === '==' && d[f] === v))
      .map(([p, d]) => new Snap(p.split('/')[1], d));
    if (this._limit != null) rows = rows.slice(0, this._limit);
    return { docs: rows, empty: rows.length === 0, size: rows.length };
  }
  async get() { await tick(); return this._run(); }
}

class DocRef {
  constructor(db, path, id) { this.db = db; this.path = path; this.id = id; }
  async get() { await tick(); return new Snap(this.id, this.db._get(this.path)); }
  async set(data, opt = {}) { await tick(); const base = opt.merge ? this.db._get(this.path) : {}; this.db._put(this.path, applyFields(base, data)); }
  async update(data) { await tick(); const cur = this.db._get(this.path); if (!cur) { const e = new Error('NOT_FOUND'); e.code = 5; throw e; } this.db._put(this.path, applyFields(cur, data)); }
  async delete() { await tick(); this.db._put(this.path, undefined); }
}

class Tx {
  constructor(db) { this.db = db; this.reads = new Map(); this.colReads = new Map(); this.ops = []; }
  async get(target) {
    await tick();
    if (target instanceof DocRef) {
      this.reads.set(target.path, this.db.ver.get(target.path) || 0);
      return new Snap(target.id, this.db._get(target.path));
    }
    this.colReads.set(target.name, this.db.colVer.get(target.name) || 0);
    return target._run();
  }
  set(ref, data, opt = {}) { this.ops.push(['set', ref, data, opt]); }
  update(ref, data) { this.ops.push(['update', ref, data]); }
  create(ref, data) { this.ops.push(['create', ref, data]); }
  delete(ref) { this.ops.push(['delete', ref]); }
  _valid() {
    for (const [p, v] of this.reads) if ((this.db.ver.get(p) || 0) !== v) return false;
    for (const [c, v] of this.colReads) if ((this.db.colVer.get(c) || 0) !== v) return false;
    return true;
  }
  _commit() {
    for (const [kind, ref, data, opt] of this.ops) {
      const cur = this.db._get(ref.path);
      if (kind === 'create') { if (cur) throw new Error('ALREADY_EXISTS'); this.db._put(ref.path, applyFields({}, data)); }
      else if (kind === 'set') this.db._put(ref.path, applyFields(opt?.merge ? cur : {}, data));
      else if (kind === 'update') { if (!cur) throw new Error('NOT_FOUND'); this.db._put(ref.path, applyFields(cur, data)); }
      else if (kind === 'delete') this.db._put(ref.path, undefined);
    }
  }
}

class FakeAuth {
  constructor() { this.users = new Map(); this.seq = 0; this.writes = 0; }
  _err(code) { const e = new Error(code); e.code = code; return e; }
  _rec(u) { return { uid: u.uid, email: u.email, emailVerified: u.emailVerified, disabled: !!u.disabled, passwordHash: undefined, providerData: [] }; }
  async getUserByEmail(email) { await tick(); const u = [...this.users.values()].find((x) => x.email === email); if (!u) throw this._err('auth/user-not-found'); return this._rec(u); }
  async createUser({ email, password, emailVerified }) {
    await tick();
    if ([...this.users.values()].some((x) => x.email === email)) throw this._err('auth/email-already-exists');
    if (password != null && String(password).length < 6) throw this._err('auth/invalid-password');
    const uid = `uid${++this.seq}`; this.writes++;
    this.users.set(uid, { uid, email, password: password ?? null, emailVerified: !!emailVerified, disabled: false });
    return this._rec(this.users.get(uid));
  }
  async updateUser(uid, props) {
    await tick();
    const u = this.users.get(uid); if (!u) throw this._err('auth/user-not-found');
    if ('password' in props && String(props.password).length < 6) throw this._err('auth/invalid-password');
    this.writes++; Object.assign(u, props); return this._rec(u);
  }
  signIn(email, password) { const u = [...this.users.values()].find((x) => x.email === email); return !!u && u.password != null && u.password === password && !u.disabled; }
  dump() { return JSON.stringify([...this.users.entries()]); }
}

module.exports = { FakeDB, FakeAuth, FieldValue };
