
const { createApp, reactive } = Vue;

/* ---------- helpers ---------- */
const bus = reactive({ toasts: [] });
function notify(msg, type = 'success') {
  const t = { id: Date.now() + Math.random(), msg, type };
  bus.toasts.push(t);
  setTimeout(() => { bus.toasts = bus.toasts.filter(x => x.id !== t.id); }, 4500);
}
const API = {
  token: localStorage.getItem('emp_token'),
  setToken(t) { this.token = t; t ? localStorage.setItem('emp_token', t) : localStorage.removeItem('emp_token'); },
  async req(method, url, body, raw) {
    const r = await fetch('/api' + url, {
      method, headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    if (raw && r.ok) return r;
    let d = null; try { d = await r.json(); } catch (e) {}
    if (!r.ok) { const e = new Error((d && (d.error || d.msg)) || 'Request failed'); e.status = r.status; throw e; }
    return d;
  },
  get(u) { return this.req('GET', u); }, post(u, b) { return this.req('POST', u, b || {}); },
  put(u, b) { return this.req('PUT', u, b || {}); }, del(u) { return this.req('DELETE', u); },
};
const qs = o => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => v !== '' && v != null && p.append(k, v)); const s = p.toString(); return s ? '?' + s : ''; };
const fmtDT = v => v ? v.replace('T', ' ').slice(0, 16) : '-';
const val = v => v ? v.slice(0, 16) : '';
const COLORS = { Draft: 'secondary', 'Slot Creation': 'info', 'Booking Open': 'success', Closed: 'warning', Completed: 'primary',
  Available: 'success', Full: 'danger', Cancelled: 'secondary', Booked: 'info', Active: 'success', Inactive: 'secondary' };
async function download(url, filename, openTab) {
  const r = await API.req('GET', url, null, true);
  const blob = await r.blob(); const u = URL.createObjectURL(blob);
  if (openTab) { window.open(u, '_blank'); return; }
  const a = document.createElement('a'); a.href = u; a.download = filename; a.click();
}
async function safe(fn) { try { return await fn(); } catch (e) { notify(e.message, 'danger'); return null; } }

/* ---------- shared components ---------- */
const Modal = { props: ['title', 'size'], emits: ['close'], template: `
  <div class="modal d-block" style="background:rgba(0,0,0,.5)" @click.self="$emit('close')">
    <div class="modal-dialog modal-dialog-scrollable" :class="size === undefined ? 'modal-lg' : size"><div class="modal-content">
      <div class="modal-header"><h5 class="modal-title">{{ title }}</h5><button class="btn-close" @click="$emit('close')"></button></div>
      <div class="modal-body"><slot></slot></div>
      <div class="modal-footer" v-if="$slots.footer"><slot name="footer"></slot></div>
    </div></div></div>` };
const Badge = { props: ['s'], template: `<span class="badge" :class="'bg-' + (map[s] || 'secondary')">{{ s }}</span>`, data: () => ({ map: COLORS }) };

/* ---------- auth ---------- */
const AuthView = { emits: ['done'], data: () => ({ mode: 'login', busy: false, f: { name: '', email: '', password: '', phone: '', roll_no: '', program: '' } }),
  methods: { async submit() {
    this.busy = true;
    await safe(async () => {
      if (this.mode === 'register') { await API.post('/auth/register', this.f); notify('Registered! Please log in.'); this.mode = 'login'; }
      else { const d = await API.post('/auth/login', { email: this.f.email, password: this.f.password }); API.setToken(d.access_token); this.$emit('done', d.user); }
    });
    this.busy = false; } },
  template: `
  <div class="container py-5" style="max-width:460px">
    <h3 class="text-center mb-1">Examination Management Portal</h3>
    <p class="text-center text-muted">Admin, Examiner and Student access</p>
    <div class="card shadow-sm"><div class="card-body">
      <ul class="nav nav-pills nav-fill mb-3">
        <li class="nav-item"><a class="nav-link" :class="{active: mode==='login'}" href="#" @click.prevent="mode='login'">Login</a></li>
        <li class="nav-item"><a class="nav-link" :class="{active: mode==='register'}" href="#" @click.prevent="mode='register'">Student Register</a></li>
      </ul>
      <form @submit.prevent="submit">
        <template v-if="mode==='register'">
          <div class="mb-2"><label class="form-label">Full name</label><input class="form-control" v-model="f.name" required></div>
          <div class="row"><div class="col mb-2"><label class="form-label">Roll no</label><input class="form-control" v-model="f.roll_no"></div>
          <div class="col mb-2"><label class="form-label">Program</label><input class="form-control" v-model="f.program"></div></div>
          <div class="mb-2"><label class="form-label">Phone</label><input class="form-control" v-model="f.phone" pattern="[0-9+ -]{7,15}" title="7-15 digits"></div>
        </template>
        <div class="mb-2"><label class="form-label">Email</label><input type="email" class="form-control" v-model="f.email" required></div>
        <div class="mb-3"><label class="form-label">Password</label><input type="password" class="form-control" v-model="f.password" minlength="6" required></div>
        <button class="btn btn-primary w-100" :disabled="busy">{{ mode==='login' ? 'Login' : 'Create account' }}</button>
      </form>
      <p class="small text-muted mt-3 mb-0" v-if="mode==='login'">Examiner accounts are created by the Admin. Default admin: admin@emp.local / admin123</p>
    </div></div></div>` };

/* ---------- profile (all roles) ---------- */
const Profile = { data: () => ({ f: {} }),
  async mounted() { this.f = { ...(await safe(() => API.get('/auth/me'))), password: '' }; },
  methods: { async save() { const r = await safe(() => API.put('/auth/me', this.f)); if (r) { notify('Profile updated'); this.f.password = ''; } } },
  template: `<div class="card shadow-sm" style="max-width:520px"><div class="card-body"><h5>My profile</h5>
    <form @submit.prevent="save">
      <div class="mb-2"><label class="form-label">Email</label><input class="form-control" :value="f.email" disabled></div>
      <div class="mb-2"><label class="form-label">Name</label><input class="form-control" v-model="f.name" required></div>
      <div class="mb-2"><label class="form-label">Phone</label><input class="form-control" v-model="f.phone" pattern="[0-9+ -]{7,15}"></div>
      <div class="mb-3"><label class="form-label">New password (optional)</label><input type="password" class="form-control" v-model="f.password" minlength="6"></div>
      <button class="btn btn-primary">Save</button></form></div></div>` };

/* ======================= ADMIN ======================= */
const AdminDashboard = { data: () => ({ s: null, charts: [] }),
  async mounted() { this.s = await safe(() => API.get('/admin/stats')); await this.$nextTick(); this.draw(); },
  beforeUnmount() { this.charts.forEach(c => c.destroy()); },
  methods: { draw() {
    if (!this.s || !window.Chart) return;
    const mk = (ref, type, labels, data, label) => this.charts.push(new Chart(this.$refs[ref], { type, data: { labels, datasets: [{ label, data, backgroundColor: '#0d6efd88', borderColor: '#0d6efd' }] }, options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } }));
    mk('c1', 'bar', this.s.popular_exams.map(x => x.name), this.s.popular_exams.map(x => x.count), 'Bookings');
    mk('c2', 'bar', this.s.examiner_workload.map(x => x.name), this.s.examiner_workload.map(x => x.count), 'Students');
    mk('c3', 'line', this.s.booking_trend.map(x => x.date.slice(5)), this.s.booking_trend.map(x => x.count), 'Bookings'); } },
  template: `<div v-if="s"><h4 class="mb-3">Admin dashboard</h4>
    <div class="row g-3 mb-4">
      <div class="col-6 col-md-3" v-for="(l,k) in {courses:'Courses',exams:'Examinations',students:'Students',examiners:'Examiners',slots:'Slots',bookings:'Bookings',pending_evaluations:'Pending evaluations'}" :key="k">
        <div class="card stat-card shadow-sm"><div class="card-body py-3"><div class="text-muted small">{{ l }}</div><div class="fs-3">{{ s[k] }}</div></div></div></div></div>
    <div class="row g-3">
      <div class="col-md-6"><div class="card"><div class="card-body"><h6>Popular examinations</h6><canvas ref="c1"></canvas></div></div></div>
      <div class="col-md-6"><div class="card"><div class="card-body"><h6>Examiner workload</h6><canvas ref="c2"></canvas></div></div></div>
      <div class="col-12"><div class="card"><div class="card-body"><h6>Booking trend (14 days)</h6><canvas ref="c3"></canvas></div></div></div>
    </div></div>` };

const AdminCourses = { components: { Modal, Badge }, data: () => ({ rows: [], q: '', m: null }),
  mounted() { this.load(); },
  methods: {
    async load() { this.rows = await safe(() => API.get('/admin/courses' + qs({ q: this.q }))) || []; },
    edit(c) { this.m = c ? { ...c } : { code: '', name: '', description: '', status: 'Active' }; },
    async save() { const m = this.m; const r = await safe(() => m.id ? API.put('/admin/courses/' + m.id, m) : API.post('/admin/courses', m)); if (r) { this.m = null; notify('Saved'); this.load(); } },
    async remove(c) { if (!confirm('Delete course ' + c.code + '?')) return; if (await safe(() => API.del('/admin/courses/' + c.id))) { notify('Deleted'); this.load(); } } },
  template: `<div><div class="d-flex flex-wrap gap-2 justify-content-between mb-3"><h4>Courses</h4>
    <div class="d-flex gap-2"><input class="form-control" placeholder="Search..." v-model="q" @input="load"><button class="btn btn-primary text-nowrap" @click="edit()">+ Add course</button></div></div>
    <div class="table-responsive"><table class="table table-hover mb-0"><thead><tr><th>Code</th><th>Name</th><th>Exams</th><th>Status</th><th></th></tr></thead>
    <tbody><tr v-for="c in rows" :key="c.id"><td>{{ c.code }}</td><td>{{ c.name }}<div class="small text-muted">{{ c.description }}</div></td><td>{{ c.exam_count }}</td><td><Badge :s="c.status"/></td>
    <td class="text-end text-nowrap"><button class="btn btn-sm btn-outline-primary me-1" @click="edit(c)">Edit</button><button class="btn btn-sm btn-outline-danger" @click="remove(c)">Delete</button></td></tr>
    <tr v-if="!rows.length"><td colspan="5" class="text-center text-muted">No courses</td></tr></tbody></table></div>
    <Modal v-if="m" :title="m.id ? 'Edit course' : 'Add course'" size="" @close="m=null"><form @submit.prevent="save" id="cf">
      <div class="mb-2"><label class="form-label">Course code</label><input class="form-control" v-model="m.code" required maxlength="20"></div>
      <div class="mb-2"><label class="form-label">Name</label><input class="form-control" v-model="m.name" required></div>
      <div class="mb-2"><label class="form-label">Description</label><textarea class="form-control" v-model="m.description"></textarea></div>
      <div class="mb-2"><label class="form-label">Status</label><select class="form-select" v-model="m.status"><option>Active</option><option>Inactive</option></select></div></form>
      <template #footer><button class="btn btn-primary" form="cf">Save</button></template></Modal></div>` };

const AdminExams = { components: { Modal, Badge }, data: () => ({ rows: [], courses: [], examiners: [], q: '', st: '', m: null, rub: null, rubs: [], rf: null }),
  async mounted() { this.courses = await API.get('/courses'); this.examiners = await API.get('/admin/examiners'); this.load(); },
  methods: {
    fmtDT, async load() { this.rows = await safe(() => API.get('/admin/exams' + qs({ q: this.q, status: this.st }))) || []; },
    edit(e) { this.m = e ? { ...e, slot_creation_start: val(e.slot_creation_start), slot_creation_end: val(e.slot_creation_end), booking_start: val(e.booking_start), booking_end: val(e.booking_end), examiner_ids: [...e.examiner_ids] }
      : { course_id: this.courses[0]?.id, name: '', exam_type: 'Viva', duration_minutes: 15, max_marks: 100, instructions: '', slot_creation_start: '', slot_creation_end: '', booking_start: '', booking_end: '', examiner_ids: [] }; },
    async save() { const m = this.m; const r = await safe(() => m.id ? API.put('/admin/exams/' + m.id, m) : API.post('/admin/exams', m)); if (r) { this.m = null; notify('Saved'); this.load(); } },
    async remove(e) { if (confirm('Delete ' + e.name + '?') && await safe(() => API.del('/admin/exams/' + e.id))) { notify('Deleted'); this.load(); } },
    async phase(e, action) { const r = await safe(() => API.post('/admin/exams/' + e.id + '/phase', { action })); if (r) { notify('Status: ' + r.status); this.load(); } },
    async publish(e) { if (!confirm('Publish results of ' + e.name + '? Students will be notified.')) return; const r = await safe(() => API.post('/admin/exams/' + e.id + '/publish')); if (r) { notify(r.message); this.load(); } },
    async openRub(e) { this.rub = e; await this.loadRub(); this.rf = { criterion: '', max_marks: 10, weightage: 1, description: '' }; },
    async loadRub() { this.rubs = await safe(() => API.get('/admin/exams/' + this.rub.id + '/rubrics')) || []; },
    async saveRub() { const f = this.rf; const r = await safe(() => f.id ? API.put('/admin/rubrics/' + f.id, f) : API.post('/admin/exams/' + this.rub.id + '/rubrics', f)); if (r) { this.rf = { criterion: '', max_marks: 10, weightage: 1, description: '' }; this.loadRub(); } },
    async delRub(r) { if (await safe(() => API.del('/admin/rubrics/' + r.id))) this.loadRub(); } },
  template: `<div><div class="d-flex flex-wrap gap-2 justify-content-between mb-3"><h4>Examinations</h4>
    <div class="d-flex gap-2 flex-wrap"><input class="form-control w-auto" placeholder="Search..." v-model="q" @input="load">
    <select class="form-select w-auto" v-model="st" @change="load"><option value="">All statuses</option><option>Draft</option><option>Slot Creation</option><option>Booking Open</option><option>Closed</option><option>Completed</option></select>
    <button class="btn btn-primary text-nowrap" @click="edit()">+ Add examination</button></div></div>
    <div class="table-responsive"><table class="table table-hover align-middle mb-0"><thead><tr><th>Examination</th><th>Type</th><th>Status</th><th>Slot creation</th><th>Booking</th><th>Examiners</th><th></th></tr></thead><tbody>
    <tr v-for="e in rows" :key="e.id"><td><b>{{ e.name }}</b><div class="small text-muted">{{ e.course_code }} · {{ e.duration_minutes }} min · {{ e.max_marks }} marks</div></td><td>{{ e.exam_type }}</td>
    <td><Badge :s="e.status"/><div v-if="e.results_published" class="small text-success">Results published</div></td>
    <td class="small">{{ fmtDT(e.slot_creation_start) }}<br>{{ fmtDT(e.slot_creation_end) }}</td><td class="small">{{ fmtDT(e.booking_start) }}<br>{{ fmtDT(e.booking_end) }}</td>
    <td class="small">{{ e.examiners.join(', ') || '-' }}</td>
    <td class="text-end"><div class="d-flex flex-wrap gap-1 justify-content-end">
      <button v-if="e.status==='Draft'" class="btn btn-sm btn-success" @click="phase(e,'open_slots')">Open slot creation</button>
      <button v-if="e.status==='Slot Creation'" class="btn btn-sm btn-warning" @click="phase(e,'close_slots')">Close slot creation</button>
      <button v-if="['Draft','Slot Creation','Closed'].includes(e.status)" class="btn btn-sm btn-success" @click="phase(e,'open_booking')">Open booking</button>
      <button v-if="e.status==='Booking Open'" class="btn btn-sm btn-warning" @click="phase(e,'close_booking')">Close booking</button>
      <button v-if="['Booking Open','Closed'].includes(e.status)" class="btn btn-sm btn-primary" @click="phase(e,'complete')">Mark completed</button>
      <button v-if="['Closed','Completed'].includes(e.status) && !e.results_published" class="btn btn-sm btn-dark" @click="publish(e)">Publish results</button>
      <button class="btn btn-sm btn-outline-secondary" @click="openRub(e)">Rubric</button>
      <button class="btn btn-sm btn-outline-primary" @click="edit(e)">Edit</button>
      <button class="btn btn-sm btn-outline-danger" @click="remove(e)">Delete</button></div></td></tr>
    <tr v-if="!rows.length"><td colspan="7" class="text-center text-muted">No examinations</td></tr></tbody></table></div>

    <Modal v-if="m" :title="m.id ? 'Edit examination' : 'Add examination'" @close="m=null"><form @submit.prevent="save" id="ef"><div class="row g-2">
      <div class="col-md-6"><label class="form-label">Course</label><select class="form-select" v-model="m.course_id" required><option v-for="c in courses" :value="c.id">{{ c.code }} - {{ c.name }}</option></select></div>
      <div class="col-md-6"><label class="form-label">Examination name</label><input class="form-control" v-model="m.name" required></div>
      <div class="col-md-4"><label class="form-label">Type</label><select class="form-select" v-model="m.exam_type"><option>Viva</option><option>Practical</option><option>Project Demo</option><option>Assessment</option></select></div>
      <div class="col-md-4"><label class="form-label">Duration (min)</label><input type="number" min="1" class="form-control" v-model="m.duration_minutes" required></div>
      <div class="col-md-4"><label class="form-label">Maximum marks</label><input type="number" min="1" step="any" class="form-control" v-model="m.max_marks" required></div>
      <div class="col-md-6"><label class="form-label">Slot creation start</label><input type="datetime-local" class="form-control" v-model="m.slot_creation_start"></div>
      <div class="col-md-6"><label class="form-label">Slot creation end</label><input type="datetime-local" class="form-control" v-model="m.slot_creation_end"></div>
      <div class="col-md-6"><label class="form-label">Booking start</label><input type="datetime-local" class="form-control" v-model="m.booking_start"></div>
      <div class="col-md-6"><label class="form-label">Booking end (cancellation deadline)</label><input type="datetime-local" class="form-control" v-model="m.booking_end"></div>
      <div class="col-12"><label class="form-label">Assigned examiners</label><select multiple class="form-select" v-model="m.examiner_ids"><option v-for="x in examiners" :value="x.id">{{ x.name }} ({{ x.department || '-' }})</option></select><div class="form-text">Ctrl/Cmd-click to select several.</div></div>
      <div class="col-12"><label class="form-label">Instructions for students</label><textarea class="form-control" v-model="m.instructions"></textarea></div></div></form>
      <template #footer><button class="btn btn-primary" form="ef">Save</button></template></Modal>

    <Modal v-if="rub" :title="'Rubric - ' + rub.name" @close="rub=null">
      <table class="table table-sm"><thead><tr><th>Criterion</th><th>Max</th><th>Weight</th><th></th></tr></thead><tbody>
        <tr v-for="r in rubs" :key="r.id"><td>{{ r.criterion }}<div class="small text-muted">{{ r.description }}</div></td><td>{{ r.max_marks }}</td><td>{{ r.weightage }}</td>
        <td class="text-end text-nowrap"><button class="btn btn-sm btn-outline-primary me-1" @click="rf={...r}">Edit</button><button class="btn btn-sm btn-outline-danger" @click="delRub(r)">x</button></td></tr>
        <tr v-if="!rubs.length"><td colspan="4" class="text-muted">No criteria yet</td></tr></tbody></table>
      <form @submit.prevent="saveRub" class="row g-2 border-top pt-3">
        <div class="col-md-5"><input class="form-control" placeholder="Criterion" v-model="rf.criterion" required></div>
        <div class="col-md-2"><input class="form-control" type="number" min="0.5" step="any" placeholder="Max" v-model="rf.max_marks" required></div>
        <div class="col-md-2"><input class="form-control" type="number" min="0.1" step="any" placeholder="Weight" v-model="rf.weightage" required></div>
        <div class="col-md-3"><button class="btn btn-primary w-100">{{ rf.id ? 'Update' : 'Add' }}</button></div>
        <div class="col-12"><input class="form-control" placeholder="Description (optional)" v-model="rf.description"></div></form></Modal></div>` };

const AdminExaminers = { components: { Modal, Badge }, data: () => ({ rows: [], q: '', m: null }),
  mounted() { this.load(); },
  methods: {
    async load() { this.rows = await safe(() => API.get('/admin/examiners' + qs({ q: this.q }))) || []; },
    edit(x) { this.m = x ? { ...x, password: '' } : { name: '', email: '', password: '', department: '', phone: '' }; },
    async save() { const m = this.m; const r = await safe(() => m.id ? API.put('/admin/examiners/' + m.id, m) : API.post('/admin/examiners', m)); if (r) { this.m = null; notify('Saved'); this.load(); } },
    async toggle(x) { if (await safe(() => API.put('/admin/examiners/' + x.id, { is_active: !x.is_active }))) this.load(); } },
  template: `<div><div class="d-flex flex-wrap gap-2 justify-content-between mb-3"><h4>Examiners</h4>
    <div class="d-flex gap-2"><input class="form-control" placeholder="Search..." v-model="q" @input="load"><button class="btn btn-primary text-nowrap" @click="edit()">+ Add examiner</button></div></div>
    <div class="table-responsive"><table class="table table-hover mb-0"><thead><tr><th>Name</th><th>Email</th><th>Department</th><th>Slots</th><th>Status</th><th></th></tr></thead><tbody>
    <tr v-for="x in rows" :key="x.id"><td>{{ x.name }}</td><td>{{ x.email }}</td><td>{{ x.department }}</td><td>{{ x.slots }}</td><td><Badge :s="x.is_active ? 'Active' : 'Inactive'"/></td>
    <td class="text-end text-nowrap"><button class="btn btn-sm btn-outline-primary me-1" @click="edit(x)">Edit</button><button class="btn btn-sm btn-outline-secondary" @click="toggle(x)">{{ x.is_active ? 'Deactivate' : 'Activate' }}</button></td></tr>
    <tr v-if="!rows.length"><td colspan="6" class="text-center text-muted">No examiners</td></tr></tbody></table></div>
    <Modal v-if="m" :title="m.id ? 'Edit examiner' : 'Add examiner'" size="" @close="m=null"><form id="xf" @submit.prevent="save">
      <div class="mb-2"><label class="form-label">Name</label><input class="form-control" v-model="m.name" required></div>
      <div class="mb-2"><label class="form-label">Email</label><input type="email" class="form-control" v-model="m.email" :disabled="!!m.id" required></div>
      <div class="mb-2"><label class="form-label">{{ m.id ? 'New password (optional)' : 'Password' }}</label><input type="password" class="form-control" v-model="m.password" minlength="6" :required="!m.id"></div>
      <div class="mb-2"><label class="form-label">Department</label><input class="form-control" v-model="m.department"></div>
      <div class="mb-2"><label class="form-label">Phone</label><input class="form-control" v-model="m.phone" pattern="[0-9+ -]{7,15}"></div></form>
      <template #footer><button class="btn btn-primary" form="xf">Save</button></template></Modal></div>` };

const AdminStudents = { components: { Badge }, data: () => ({ rows: [], q: '' }), mounted() { this.load(); },
  methods: { async load() { this.rows = await safe(() => API.get('/admin/students' + qs({ q: this.q }))) || []; },
    async toggle(s) { if (await safe(() => API.put('/admin/students/' + s.id, { is_active: !s.is_active }))) this.load(); } },
  template: `<div><div class="d-flex justify-content-between mb-3"><h4>Students</h4><input class="form-control w-auto" placeholder="Search name / email" v-model="q" @input="load"></div>
    <div class="table-responsive"><table class="table table-hover mb-0"><thead><tr><th>Name</th><th>Email</th><th>Roll no</th><th>Program</th><th>Bookings</th><th>Status</th><th></th></tr></thead><tbody>
    <tr v-for="s in rows" :key="s.id"><td>{{ s.name }}</td><td>{{ s.email }}</td><td>{{ s.roll_no }}</td><td>{{ s.program }}</td><td>{{ s.bookings }}</td><td><Badge :s="s.is_active ? 'Active' : 'Inactive'"/></td>
    <td class="text-end"><button class="btn btn-sm btn-outline-secondary" @click="toggle(s)">{{ s.is_active ? 'Deactivate' : 'Activate' }}</button></td></tr>
    <tr v-if="!rows.length"><td colspan="7" class="text-center text-muted">No students</td></tr></tbody></table></div></div>` };

const AdminSlots = { components: { Modal, Badge }, data: () => ({ rows: [], exams: [], examiners: [], exam_id: '', rs: null, ch: null, newEx: '' }),
  async mounted() { this.exams = await API.get('/admin/exams'); this.examiners = await API.get('/admin/examiners'); this.load(); },
  methods: { async load() { this.rows = await safe(() => API.get('/admin/slots' + qs({ exam_id: this.exam_id }))) || []; },
    async saveRs() { if (await safe(() => API.put('/admin/slots/' + this.rs.id, this.rs))) { this.rs = null; notify('Slot rescheduled'); this.load(); } },
    async saveEx() { if (await safe(() => API.put('/admin/slots/' + this.ch.id + '/examiner', { examiner_id: this.newEx }))) { this.ch = null; notify('Examiner changed'); this.load(); } } },
  template: `<div><div class="d-flex flex-wrap gap-2 justify-content-between mb-3"><h4>All examiner slots</h4>
    <select class="form-select w-auto" v-model="exam_id" @change="load"><option value="">All examinations</option><option v-for="e in exams" :value="e.id">{{ e.name }}</option></select></div>
    <div class="table-responsive"><table class="table table-hover mb-0"><thead><tr><th>Examination</th><th>Examiner</th><th>Date</th><th>Time</th><th>Seats</th><th>Status</th><th></th></tr></thead><tbody>
    <tr v-for="s in rows" :key="s.id"><td>{{ s.exam_name }}</td><td>{{ s.examiner_name }}</td><td>{{ s.date }}</td><td>{{ s.start_time }}-{{ s.end_time }}</td><td>{{ s.available_seats }}/{{ s.capacity }}</td><td><Badge :s="s.status"/></td>
    <td class="text-end text-nowrap"><button class="btn btn-sm btn-outline-primary me-1" @click="rs={...s}">Reschedule</button><button class="btn btn-sm btn-outline-secondary" @click="ch=s; newEx=''">Change examiner</button></td></tr>
    <tr v-if="!rows.length"><td colspan="7" class="text-center text-muted">No slots</td></tr></tbody></table></div>
    <Modal v-if="rs" title="Reschedule slot (exceptional)" size="" @close="rs=null"><form id="rf" @submit.prevent="saveRs">
      <div class="mb-2"><label class="form-label">Date</label><input type="date" class="form-control" v-model="rs.date" required></div>
      <div class="row"><div class="col mb-2"><label class="form-label">Start</label><input type="time" class="form-control" v-model="rs.start_time" required></div><div class="col mb-2"><label class="form-label">End</label><input type="time" class="form-control" v-model="rs.end_time" required></div></div>
      <div class="mb-2"><label class="form-label">Meeting link</label><input class="form-control" v-model="rs.meeting_link"></div></form>
      <template #footer><button class="btn btn-primary" form="rf">Save</button></template></Modal>
    <Modal v-if="ch" title="Change assigned examiner" size="" @close="ch=null"><p>Slot: {{ ch.exam_name }} on {{ ch.date }} {{ ch.start_time }} (currently {{ ch.examiner_name }})</p>
      <select class="form-select" v-model="newEx"><option value="">Select examiner</option><option v-for="x in examiners.filter(x => x.is_active && x.id !== ch.examiner_id)" :value="x.id">{{ x.name }}</option></select>
      <template #footer><button class="btn btn-primary" :disabled="!newEx" @click="saveEx">Change</button></template></Modal></div>` };

const AdminBookings = { components: { Modal, Badge }, data: () => ({ rows: [], q: '', st: '', mv: null, slots: [], target: '' }), mounted() { this.load(); },
  methods: { async load() { this.rows = await safe(() => API.get('/admin/bookings' + qs({ q: this.q, status: this.st }))) || []; },
    async openMove(b) { this.mv = b; this.target = ''; this.slots = (await safe(() => API.get('/admin/slots?exam_id=' + b.exam_id)) || []).filter(s => s.id !== b.slot.id && s.available_seats > 0 && s.status === 'Available'); },
    async move() { if (await safe(() => API.put('/admin/bookings/' + this.mv.id + '/reschedule', { slot_id: this.target }))) { this.mv = null; notify('Booking moved'); this.load(); } } },
  template: `<div><div class="d-flex flex-wrap gap-2 justify-content-between mb-3"><h4>Bookings</h4>
    <div class="d-flex gap-2"><input class="form-control" placeholder="Student / exam" v-model="q" @input="load"><select class="form-select w-auto" v-model="st" @change="load"><option value="">All</option><option>Booked</option><option>Cancelled</option><option>Completed</option></select></div></div>
    <div class="table-responsive"><table class="table table-hover mb-0"><thead><tr><th>Student</th><th>Examination</th><th>Slot</th><th>Examiner</th><th>Status</th><th></th></tr></thead><tbody>
    <tr v-for="b in rows" :key="b.id"><td>{{ b.student_name }}<div class="small text-muted">{{ b.student_email }}</div></td><td>{{ b.exam_name }}</td><td>{{ b.slot.date }} {{ b.slot.start_time }}</td><td>{{ b.slot.examiner_name }}</td><td><Badge :s="b.status"/></td>
    <td class="text-end"><button v-if="b.status==='Booked'" class="btn btn-sm btn-outline-primary" @click="openMove(b)">Reschedule / reassign</button></td></tr>
    <tr v-if="!rows.length"><td colspan="6" class="text-center text-muted">No bookings</td></tr></tbody></table></div>
    <Modal v-if="mv" title="Move booking to another slot" size="" @close="mv=null"><p>{{ mv.student_name }} - {{ mv.exam_name }}</p>
      <select class="form-select" v-model="target"><option value="">Select slot (same examination)</option><option v-for="s in slots" :value="s.id">{{ s.date }} {{ s.start_time }}-{{ s.end_time }} · {{ s.examiner_name }} · {{ s.available_seats }} seat(s)</option></select>
      <div v-if="!slots.length" class="text-muted small mt-2">No other slots with free seats.</div>
      <template #footer><button class="btn btn-primary" :disabled="!target" @click="move">Move</button></template></Modal></div>` };

const AdminSearch = { components: { Badge }, data: () => ({ q: '', r: null }),
  methods: { async go() { this.r = await safe(() => API.get('/admin/search' + qs({ q: this.q }))); } },
  template: `<div><h4>Search</h4><form class="d-flex gap-2 mb-3" @submit.prevent="go"><input class="form-control" placeholder="Students, examiners, examinations, bookings..." v-model="q" minlength="2" required><button class="btn btn-primary">Search</button></form>
    <div v-if="r" class="row g-3">
      <div class="col-md-6"><div class="card"><div class="card-header">Students ({{ r.students.length }})</div><ul class="list-group list-group-flush"><li class="list-group-item" v-for="s in r.students">{{ s.name }} <span class="text-muted small">{{ s.email }}</span></li></ul></div></div>
      <div class="col-md-6"><div class="card"><div class="card-header">Examiners ({{ r.examiners.length }})</div><ul class="list-group list-group-flush"><li class="list-group-item" v-for="s in r.examiners">{{ s.name }} <span class="text-muted small">{{ s.email }}</span></li></ul></div></div>
      <div class="col-md-6"><div class="card"><div class="card-header">Examinations ({{ r.exams.length }})</div><ul class="list-group list-group-flush"><li class="list-group-item" v-for="e in r.exams">{{ e.name }} <Badge :s="e.status"/></li></ul></div></div>
      <div class="col-md-6"><div class="card"><div class="card-header">Bookings ({{ r.bookings.length }})</div><ul class="list-group list-group-flush"><li class="list-group-item" v-for="b in r.bookings">{{ b.student_name }} - {{ b.exam_name }} <Badge :s="b.status"/></li></ul></div></div></div></div>` };

/* ======================= EXAMINER ======================= */
const ExDashboard = { components: { Badge }, data: () => ({ d: null }), async mounted() { this.d = await safe(() => API.get('/examiner/dashboard')); },
  template: `<div v-if="d"><h4 class="mb-3">Examiner dashboard</h4><div class="row g-3 mb-4">
    <div class="col-6 col-md-3"><div class="card stat-card"><div class="card-body py-3"><div class="text-muted small">Assigned examinations</div><div class="fs-3">{{ d.exams.length }}</div></div></div></div>
    <div class="col-6 col-md-3"><div class="card stat-card"><div class="card-body py-3"><div class="text-muted small">My slots</div><div class="fs-3">{{ d.slot_count }}</div></div></div></div>
    <div class="col-6 col-md-3"><div class="card stat-card"><div class="card-body py-3"><div class="text-muted small">Booked students</div><div class="fs-3">{{ d.booked_students }}</div></div></div></div>
    <div class="col-6 col-md-3"><div class="card stat-card"><div class="card-body py-3"><div class="text-muted small">Pending evaluations</div><div class="fs-3">{{ d.pending_evaluations }}</div></div></div></div></div>
    <h5>Assigned examinations</h5><div class="table-responsive"><table class="table mb-0"><thead><tr><th>Examination</th><th>Course</th><th>Type</th><th>Status</th></tr></thead><tbody>
    <tr v-for="e in d.exams"><td>{{ e.name }}</td><td>{{ e.course_code }}</td><td>{{ e.exam_type }}</td><td><Badge :s="e.status"/></td></tr>
    <tr v-if="!d.exams.length"><td colspan="4" class="text-muted text-center">Nothing assigned yet</td></tr></tbody></table></div></div>` };

const ExSlots = { components: { Modal, Badge }, data: () => ({ exams: [], rows: [], exam_id: '', m: null, st: null, stu: [] }),
  async mounted() { this.exams = (await API.get('/examiner/dashboard')).exams; this.load(); },
  methods: {
    async load() { this.rows = await safe(() => API.get('/examiner/slots' + qs({ exam_id: this.exam_id }))) || []; },
    edit(s) { this.m = s ? { ...s } : { exam_id: this.exam_id || this.exams[0]?.id, date: '', start_time: '', end_time: '', capacity: 1, meeting_link: '' }; },
    async save() { const m = this.m; const r = await safe(() => m.id ? API.put('/examiner/slots/' + m.id, m) : API.post('/examiner/slots', m)); if (r) { this.m = null; notify('Saved'); this.load(); } },
    async remove(s) { if (confirm('Delete this slot?') && await safe(() => API.del('/examiner/slots/' + s.id))) { notify('Deleted'); this.load(); } },
    async students(s) { this.st = s; this.stu = await safe(() => API.get('/examiner/slots/' + s.id + '/bookings')) || []; },
    async complete(s) { if (await safe(() => API.post('/examiner/slots/' + s.id + '/complete'))) { notify('Slot completed'); this.load(); } } },
  template: `<div><div class="d-flex flex-wrap gap-2 justify-content-between mb-3"><h4>My slots</h4><div class="d-flex gap-2">
    <select class="form-select w-auto" v-model="exam_id" @change="load"><option value="">All examinations</option><option v-for="e in exams" :value="e.id">{{ e.name }}</option></select>
    <button class="btn btn-primary text-nowrap" @click="edit()" :disabled="!exams.length">+ Create slot</button></div></div>
    <div class="table-responsive"><table class="table table-hover mb-0"><thead><tr><th>Examination</th><th>Date</th><th>Time</th><th>Seats</th><th>Status</th><th></th></tr></thead><tbody>
    <tr v-for="s in rows" :key="s.id"><td>{{ s.exam_name }}</td><td>{{ s.date }}</td><td>{{ s.start_time }}-{{ s.end_time }}</td><td>{{ s.available_seats }}/{{ s.capacity }}</td><td><Badge :s="s.status"/></td>
    <td class="text-end text-nowrap"><button class="btn btn-sm btn-outline-info me-1" @click="students(s)">Students</button><button class="btn btn-sm btn-outline-primary me-1" @click="edit(s)">Edit</button>
    <button class="btn btn-sm btn-outline-danger me-1" @click="remove(s)">Delete</button><button v-if="s.status!=='Completed'" class="btn btn-sm btn-outline-success" @click="complete(s)">Complete</button></td></tr>
    <tr v-if="!rows.length"><td colspan="6" class="text-center text-muted">No slots</td></tr></tbody></table></div>
    <Modal v-if="m" :title="m.id ? 'Edit slot' : 'Create slot'" size="" @close="m=null"><form id="sf" @submit.prevent="save">
      <div class="mb-2"><label class="form-label">Examination</label><select class="form-select" v-model="m.exam_id" :disabled="!!m.id" required><option v-for="e in exams" :value="e.id">{{ e.name }} ({{ e.status }})</option></select></div>
      <div class="mb-2"><label class="form-label">Date</label><input type="date" class="form-control" v-model="m.date" required></div>
      <div class="row"><div class="col mb-2"><label class="form-label">Start</label><input type="time" class="form-control" v-model="m.start_time" required></div><div class="col mb-2"><label class="form-label">End</label><input type="time" class="form-control" v-model="m.end_time" required></div></div>
      <div class="mb-2"><label class="form-label">Capacity</label><input type="number" min="1" class="form-control" v-model="m.capacity" required></div>
      <div class="mb-2"><label class="form-label">Meeting link (optional)</label><input type="url" class="form-control" v-model="m.meeting_link"></div></form>
      <template #footer><button class="btn btn-primary" form="sf">Save</button></template></Modal>
    <Modal v-if="st" :title="'Students - ' + st.date + ' ' + st.start_time" size="" @close="st=null"><ul class="list-group"><li class="list-group-item d-flex justify-content-between" v-for="b in stu">
      <span>{{ b.student_name }} <span class="small text-muted">{{ b.student_email }}</span></span><Badge :s="b.status"/></li></ul><p v-if="!stu.length" class="text-muted">No students booked.</p></Modal></div>` };

const ExEvaluate = { components: { Modal, Badge }, data: () => ({ rows: [], pending: '1', ev: null, rubrics: [], scores: {}, remarks: '', total: '' }),
  mounted() { this.load(); },
  computed: { preview() {
    if (!this.rubrics.length) return null; let w = 0, p = 0;
    for (const r of this.rubrics) { const m = parseFloat(this.scores[r.id]); if (isNaN(m)) return null; w += r.weightage; p += (m / r.max_marks) * r.weightage; }
    return (p / w * this.ev.exam_max).toFixed(2); } },
  methods: {
    async load() { this.rows = await safe(() => API.get('/examiner/bookings' + qs({ pending: this.pending }))) || []; },
    async open(b) {
      this.rubrics = await API.get('/exams/' + b.exam_id + '/rubrics'); const old = await API.get('/examiner/bookings/' + b.id + '/evaluation');
      this.scores = {}; (old?.scores || []).forEach(s => this.scores[s.rubric_id] = s.marks);
      this.remarks = old?.remarks || ''; this.total = old?.total_marks ?? ''; this.ev = { ...b, exam_max: b.max_marks }; },
    async submit() {
      const body = { remarks: this.remarks, total_marks: this.total, scores: this.rubrics.map(r => ({ rubric_id: r.id, marks: this.scores[r.id] })) };
      const r = await safe(() => API.post('/examiner/bookings/' + this.ev.id + '/evaluate', body)); if (r) { notify('Saved: ' + r.total_marks + ' marks'); this.ev = null; this.load(); } } },
  template: `<div><div class="d-flex justify-content-between mb-3"><h4>Evaluations</h4>
    <select class="form-select w-auto" v-model="pending" @change="load"><option value="1">Pending only</option><option value="">All my students</option></select></div>
    <div class="table-responsive"><table class="table table-hover mb-0"><thead><tr><th>Student</th><th>Examination</th><th>Slot</th><th>Status</th><th></th></tr></thead><tbody>
    <tr v-for="b in rows" :key="b.id"><td>{{ b.student_name }}</td><td>{{ b.exam_name }}</td><td>{{ b.slot.date }} {{ b.slot.start_time }}</td><td><Badge :s="b.status"/></td>
    <td class="text-end"><button class="btn btn-sm btn-primary" :disabled="b.results_published" @click="open(b)">{{ b.evaluated ? 'Edit evaluation' : 'Evaluate' }}</button></td></tr>
    <tr v-if="!rows.length"><td colspan="5" class="text-center text-muted">Nothing to evaluate</td></tr></tbody></table></div>
    <Modal v-if="ev" :title="'Evaluate - ' + ev.student_name" @close="ev=null"><form id="evf" @submit.prevent="submit">
      <div v-if="rubrics.length"><div class="row g-2 mb-2 align-items-center" v-for="r in rubrics" :key="r.id">
        <div class="col-7"><b>{{ r.criterion }}</b> <span class="small text-muted">(weight {{ r.weightage }})</span><div class="small text-muted">{{ r.description }}</div></div>
        <div class="col-5"><div class="input-group"><input type="number" class="form-control" min="0" :max="r.max_marks" step="any" v-model="scores[r.id]" required><span class="input-group-text">/ {{ r.max_marks }}</span></div></div></div>
        <div class="alert alert-info py-2">Total (weighted, out of {{ ev.exam_max }}): <b>{{ preview ?? '-' }}</b></div></div>
      <div v-else class="mb-2"><label class="form-label">Total marks (no rubric defined)</label><input type="number" min="0" step="any" class="form-control" v-model="total" required></div>
      <label class="form-label">Remarks / feedback</label><textarea class="form-control" v-model="remarks" rows="3"></textarea></form>
      <template #footer><button class="btn btn-primary" form="evf">Submit evaluation</button></template></Modal></div>` };

/* ======================= STUDENT ======================= */
const StDashboard = { components: { Badge }, emits: ['go'], data: () => ({ d: null }), async mounted() { this.d = await safe(() => API.get('/student/dashboard')); },
  template: `<div v-if="d"><h4 class="mb-3">Student dashboard</h4><div class="row g-3 mb-4">
    <div class="col-6 col-md-3"><div class="card stat-card"><div class="card-body py-3"><div class="text-muted small">Available examinations</div><div class="fs-3">{{ d.available_exams.length }}</div></div></div></div>
    <div class="col-6 col-md-3"><div class="card stat-card"><div class="card-body py-3"><div class="text-muted small">Available slots</div><div class="fs-3">{{ d.available_slots }}</div></div></div></div>
    <div class="col-6 col-md-3"><div class="card stat-card"><div class="card-body py-3"><div class="text-muted small">Booked slots</div><div class="fs-3">{{ d.booked.length }}</div></div></div></div>
    <div class="col-6 col-md-3"><div class="card stat-card"><div class="card-body py-3"><div class="text-muted small">Published results</div><div class="fs-3">{{ d.results }}</div></div></div></div></div>
    <div class="row g-3"><div class="col-md-6"><div class="card"><div class="card-header">Upcoming examinations</div><ul class="list-group list-group-flush">
      <li class="list-group-item" v-for="b in d.upcoming"><b>{{ b.exam_name }}</b><div class="small text-muted">{{ b.slot.date }} {{ b.slot.start_time }} · {{ b.slot.examiner_name }}</div></li>
      <li class="list-group-item text-muted" v-if="!d.upcoming.length">None</li></ul></div></div>
    <div class="col-md-6"><div class="card"><div class="card-header">Open for booking</div><ul class="list-group list-group-flush">
      <li class="list-group-item d-flex justify-content-between" v-for="e in d.available_exams"><span>{{ e.name }} <span class="small text-muted">{{ e.course_code }}</span></span><a href="#/StExams">Book</a></li>
      <li class="list-group-item text-muted" v-if="!d.available_exams.length">None right now</li></ul></div></div></div></div>` };

const StExams = { components: { Modal, Badge }, data: () => ({ rows: [], courses: [], f: { q: '', exam_type: '', course_id: '', status: '' }, sel: null, info: null }),
  async mounted() { this.courses = await API.get('/courses'); this.load(); },
  methods: { fmtDT, async load() { this.rows = await safe(() => API.get('/student/exams' + qs(this.f))) || []; },
    async view(e) { this.sel = e; this.info = await safe(() => API.get('/student/exams/' + e.id + '/slots')); },
    async book(s) { if (!confirm('Book ' + s.date + ' ' + s.start_time + ' with ' + s.examiner_name + '?')) return; const r = await safe(() => API.post('/student/slots/' + s.id + '/book')); if (r) { notify('Slot booked!'); this.sel = null; this.load(); } else this.view(this.sel); } },
  template: `<div><h4 class="mb-3">Examinations</h4>
    <div class="row g-2 mb-3"><div class="col-md-4"><input class="form-control" placeholder="Search examinations / courses" v-model="f.q" @input="load"></div>
    <div class="col-md-3"><select class="form-select" v-model="f.exam_type" @change="load"><option value="">All types</option><option>Viva</option><option>Practical</option><option>Project Demo</option><option>Assessment</option></select></div>
    <div class="col-md-3"><select class="form-select" v-model="f.course_id" @change="load"><option value="">All courses</option><option v-for="c in courses" :value="c.id">{{ c.code }}</option></select></div>
    <div class="col-md-2"><select class="form-select" v-model="f.status" @change="load"><option value="">Any status</option><option>Slot Creation</option><option>Booking Open</option><option>Closed</option><option>Completed</option></select></div></div>
    <div class="row g-3"><div class="col-md-6 col-lg-4" v-for="e in rows" :key="e.id"><div class="card h-100 shadow-sm"><div class="card-body">
      <div class="d-flex justify-content-between"><h6>{{ e.name }}</h6><Badge :s="e.status"/></div><div class="small text-muted mb-2">{{ e.course_code }} · {{ e.exam_type }} · {{ e.duration_minutes }} min · {{ e.max_marks }} marks</div>
      <div class="small">Booking: {{ fmtDT(e.booking_start) }} → {{ fmtDT(e.booking_end) }}</div>
      <div v-if="e.my_booking" class="alert alert-success py-1 mt-2 mb-0 small">Booked: {{ e.my_booking.slot.date }} {{ e.my_booking.slot.start_time }}</div></div>
      <div class="card-footer bg-white"><button class="btn btn-sm btn-primary" @click="view(e)">{{ e.my_booking ? 'View' : 'View slots' }}</button></div></div></div>
      <div class="col-12 text-center text-muted" v-if="!rows.length">No examinations found</div></div>
    <Modal v-if="sel" :title="sel.name" @close="sel=null"><div v-if="info">
      <p class="mb-1"><b>Instructions:</b> {{ info.exam.instructions || 'None' }}</p>
      <div v-if="info.rubrics.length" class="mb-3"><b>Evaluation rubric:</b><ul class="mb-0"><li v-for="r in info.rubrics">{{ r.criterion }} - {{ r.max_marks }} marks</li></ul></div>
      <div v-if="!sel.booking_open" class="alert alert-warning py-2">Booking is not currently open for this examination.</div>
      <table class="table table-sm align-middle"><thead><tr><th>Date</th><th>Time</th><th>Examiner</th><th>Seats</th><th></th></tr></thead><tbody>
        <tr v-for="s in info.slots" :key="s.id"><td>{{ s.date }}</td><td>{{ s.start_time }}-{{ s.end_time }}</td><td>{{ s.examiner_name }}</td><td><Badge :s="s.status"/> {{ s.available_seats }}/{{ s.capacity }}</td>
        <td class="text-end"><button class="btn btn-sm btn-success" :disabled="!sel.booking_open || sel.my_booking || s.status!=='Available'" @click="book(s)">Book</button></td></tr>
        <tr v-if="!info.slots.length"><td colspan="5" class="text-muted text-center">No slots published</td></tr></tbody></table></div></Modal></div>` };

const StBookings = { components: { Badge }, data: () => ({ rows: [], task: null, state: '', file: '', timer: null }), mounted() { this.load(); }, beforeUnmount() { clearInterval(this.timer); },
  methods: { async load() { this.rows = await safe(() => API.get('/student/bookings')) || []; },
    async cancel(b) { if (confirm('Cancel this booking?') && await safe(() => API.post('/student/bookings/' + b.id + '/cancel'))) { notify('Booking cancelled'); this.load(); } },
    async exp() { const r = await safe(() => API.post('/student/export')); if (!r) return; this.task = r.task_id; this.state = 'PENDING'; this.file = '';
      this.timer = setInterval(async () => { const s = await API.get('/student/export/' + this.task).catch(() => null); if (!s) return; this.state = s.state;
        if (s.state === 'SUCCESS') { this.file = s.file; clearInterval(this.timer); notify('Export ready - download below', 'info'); } if (s.state === 'FAILURE') clearInterval(this.timer); }, 2000); },
    dl() { safe(() => download('/student/export/file/' + this.file, this.file)); },
    sc(b) { safe(() => download('/student/bookings/' + b.id + '/scorecard', '', true)); } },
  template: `<div><div class="d-flex flex-wrap gap-2 justify-content-between mb-3"><h4>My bookings &amp; history</h4>
    <div class="d-flex gap-2 align-items-center"><span v-if="state && state!=='SUCCESS' && state!=='FAILURE'" class="spinner-border spinner-border-sm"></span>
    <button v-if="file" class="btn btn-success" @click="dl">Download CSV</button><button class="btn btn-outline-primary" @click="exp">Export history (CSV)</button></div></div>
    <div class="table-responsive"><table class="table table-hover mb-0"><thead><tr><th>Examination</th><th>Course</th><th>Slot</th><th>Examiner</th><th>Status</th><th>Marks</th><th></th></tr></thead><tbody>
    <tr v-for="b in rows" :key="b.id"><td>{{ b.exam_name }}</td><td>{{ b.course }}</td><td>{{ b.slot.date }} {{ b.slot.start_time }}</td><td>{{ b.slot.examiner_name }}</td><td><Badge :s="b.status"/></td>
    <td>{{ b.marks != null ? b.marks + '/' + b.max_marks : '-' }}</td><td class="text-end text-nowrap">
    <button v-if="b.status==='Booked'" class="btn btn-sm btn-outline-danger" @click="cancel(b)">Cancel</button>
    <button v-if="b.marks != null" class="btn btn-sm btn-outline-secondary" @click="sc(b)">Scorecard</button></td></tr>
    <tr v-if="!rows.length"><td colspan="7" class="text-center text-muted">No bookings yet</td></tr></tbody></table></div></div>` };

const StResults = { data: () => ({ rows: [] }), async mounted() { this.rows = await safe(() => API.get('/student/results')) || []; },
  methods: { sc(b) { safe(() => download('/student/bookings/' + b.id + '/scorecard', '', true)); }, name(rs, id) { return rs.find(r => r.id === id) } },
  template: `<div><h4 class="mb-3">Published results</h4>
    <div class="card mb-3 shadow-sm" v-for="r in rows" :key="r.booking.id"><div class="card-body">
      <div class="d-flex justify-content-between flex-wrap"><div><h6 class="mb-0">{{ r.booking.exam_name }}</h6><div class="small text-muted">{{ r.booking.course }} · Examiner: {{ r.evaluation.examiner }}</div></div>
      <div class="fs-4">{{ r.evaluation.total_marks }} / {{ r.evaluation.max_marks }}</div></div>
      <table class="table table-sm mt-2 mb-2"><tbody><tr v-for="s in r.evaluation.scores"><td>{{ name(r.rubrics, s.rubric_id)?.criterion }}</td><td class="text-end">{{ s.marks }} / {{ name(r.rubrics, s.rubric_id)?.max_marks }}</td></tr></tbody></table>
      <p class="mb-2"><b>Examiner feedback:</b> {{ r.evaluation.remarks || '-' }}</p><button class="btn btn-sm btn-outline-secondary" @click="sc(r.booking)">Open scorecard</button></div></div>
    <p class="text-muted" v-if="!rows.length">No results have been published yet.</p></div>` };

/* ======================= ROOT ======================= */
const MENUS = {
  admin: [['AdminDashboard', 'Dashboard'], ['AdminCourses', 'Courses'], ['AdminExams', 'Exams'], ['AdminExaminers', 'Examiners'], ['AdminStudents', 'Students'], ['AdminSlots', 'Slots'], ['AdminBookings', 'Bookings'], ['AdminSearch', 'Search']],
  examiner: [['ExDashboard', 'Dashboard'], ['ExSlots', 'Slots'], ['ExEvaluate', 'Evaluations'], ['Profile', 'Profile']],
  student: [['StDashboard', 'Dashboard'], ['StExams', 'Examinations'], ['StBookings', 'My bookings'], ['StResults', 'Results'], ['Profile', 'Profile']] };

const App = { data: () => ({ user: null, view: '', toasts: bus.toasts, notes: { unread: 0, items: [] }, showNotes: false, seen: new Set(), poll: null, ready: false, open: false }),
  computed: { menu() { return this.user ? MENUS[this.user.role] : []; } },
  async mounted() {
    window.addEventListener('hashchange', () => { this.view = location.hash.replace('#/', '') || this.menu[0]?.[0]; this.open = false; });
    if (API.token) { try { this.start(await API.get('/auth/me')); } catch (e) { API.setToken(null); } }
    this.ready = true; },
  methods: {
    start(u) { this.user = u; const h = location.hash.replace('#/', ''); this.view = this.menu.find(m => m[0] === h) ? h : this.menu[0][0]; location.hash = '#/' + this.view; this.pollNotes(); this.poll = setInterval(this.pollNotes, 15000); },
    async pollNotes() { try { const n = await API.get('/notifications'); const fresh = n.items.filter(i => !i.is_read && !this.seen.has(i.id));
      if (this.seen.size) fresh.forEach(i => notify(i.message, 'info')); n.items.forEach(i => this.seen.add(i.id)); this.seen.add(0); this.notes = n; } catch (e) {} },
    async readAll() { await API.post('/notifications/read'); this.pollNotes(); },
    logout() { clearInterval(this.poll); API.setToken(null); this.user = null; this.seen = new Set(); location.hash = ''; } },
  template: `<div v-if="ready">
    <div class="toast-box"><div v-for="t in toasts" :key="t.id" class="alert shadow-sm py-2 mb-2" :class="'alert-' + t.type">{{ t.msg }}</div></div>
    <AuthView v-if="!user" @done="start"/>
    <template v-else>
      <nav class="navbar navbar-expand-lg navbar-dark bg-dark sticky-top"><div class="container-fluid">
        <span class="navbar-brand">EMP <span class="badge bg-secondary text-capitalize">{{ user.role }}</span></span>
        <button class="navbar-toggler" @click="open=!open"><span class="navbar-toggler-icon"></span></button>
        <div class="navbar-collapse" :class="{collapse: !open}"><ul class="navbar-nav me-auto">
          <li class="nav-item" v-for="m in menu" :key="m[0]"><a class="nav-link" :class="{active: view===m[0]}" :href="'#/' + m[0]">{{ m[1] }}</a></li></ul>
          <div class="d-flex align-items-center gap-3 position-relative">
            <a href="#" class="text-white text-decoration-none" @click.prevent="showNotes=!showNotes">&#128276; <span v-if="notes.unread" class="badge bg-danger">{{ notes.unread }}</span></a>
            <div v-if="showNotes" class="card position-absolute end-0 shadow" style="top:35px;width:320px;max-width:85vw;z-index:1500"><div class="card-header d-flex justify-content-between">Notifications<a href="#" @click.prevent="readAll">Mark read</a></div>
              <ul class="list-group list-group-flush" style="max-height:300px;overflow:auto"><li class="list-group-item small" :class="{'fw-bold': !n.is_read}" v-for="n in notes.items">{{ n.message }}</li><li class="list-group-item small text-muted" v-if="!notes.items.length">Nothing yet</li></ul></div>
            <span class="text-white-50 small d-none d-lg-inline">{{ user.name }}</span><button class="btn btn-sm btn-outline-light" @click="logout">Logout</button></div></div></div></nav>
      <main class="container-fluid py-4 px-3 px-md-4"><component :is="view" :key="view"/></main>
    </template></div>`,
};

const app = createApp(App);
Object.entries({ Modal, Badge, AuthView, Profile, AdminDashboard, AdminCourses, AdminExams, AdminExaminers, AdminStudents, AdminSlots, AdminBookings, AdminSearch,
  ExDashboard, ExSlots, ExEvaluate, StDashboard, StExams, StBookings, StResults }).forEach(([k, v]) => app.component(k, v));
app.mount('#app');
