/* ============================================================
   PRESCRIX — Full Application Logic (Fixed & Complete)
   localStorage-based, no backend needed
   ============================================================ */

// ======================== STATE ========================
let currentUser = null;
let db = { prescriptions:[], doctors:[], notes:[], reminders:[], family:[], notifications:[] };
let rxFilter = 'all';
let rxSort = 'date-desc';
let pendingConfirm = null;
let searchResultsCache = [];

// ======================== INIT ========================
document.addEventListener('DOMContentLoaded', () => {
  const raw = localStorage.getItem('px_current_user');
  if (raw) {
    try { currentUser = JSON.parse(raw); } catch(e) { currentUser = null; }
  }
  if (currentUser) {
    loadDB();
    showApp();
  } else {
    document.getElementById('authScreen').style.display = 'flex';
  }

  // Default today for date inputs
  const today = todayStr();
  ['rx_date','note_date','rem_date'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = today;
  });

  // Close dropdowns on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-box')) hideSearchDrop();
    if (!e.target.closest('#notifPanel') && !e.target.closest('.icon-btn')) {
      const p = document.getElementById('notifPanel');
      if (p) p.style.display = 'none';
    }
  });

  // Keyboard: Escape closes topmost modal
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const open = [...document.querySelectorAll('.modal-backdrop')]
        .find(m => m.style.display !== 'none');
      if (open) closeModal(open.id);
    }
  });
});

// ======================== AUTH ========================
function switchAuth(mode) {
  document.getElementById('loginForm').style.display  = mode === 'login'  ? 'block' : 'none';
  document.getElementById('signupForm').style.display = mode === 'signup' ? 'block' : 'none';
  document.getElementById('tabLogin').classList.toggle('active',  mode === 'login');
  document.getElementById('tabSignup').classList.toggle('active', mode === 'signup');
  clearAuthErrs();
}

function clearAuthErrs() {
  ['li_email_err','li_pass_err','su_name_err','su_email_err','su_pass_err']
    .forEach(id => { const e = document.getElementById(id); if(e) e.textContent=''; });
}

function togglePw(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
  btn.textContent = inp.type === 'text' ? '🙈' : '👁';
}

function doLogin() {
  const email = val('li_email');
  const pass  = val('li_pass');
  let ok = true;
  if (!email || !isEmail(email)) { setErr('li_email_err','Enter a valid email.'); ok=false; }
  else clearErr('li_email_err');
  if (!pass || pass.length < 6) { setErr('li_pass_err','Password must be at least 6 characters.'); ok=false; }
  else clearErr('li_pass_err');
  if (!ok) return;

  const users = getUsers();
  const user  = users.find(u => u.email === email && u.password === simpleHash(pass));
  if (!user) { setErr('li_pass_err','Incorrect email or password.'); return; }

  currentUser = user;
  saveCurrentUser();
  loadDB();
  showApp();
  toast('Welcome back, ' + firstName(user.name) + '!', 'success');
}

function doSignup() {
  const name  = val('su_name');
  const email = val('su_email');
  const pass  = val('su_pass');
  let ok = true;
  if (!name || name.length < 2)  { setErr('su_name_err','Enter your full name.'); ok=false; } else clearErr('su_name_err');
  if (!email || !isEmail(email)) { setErr('su_email_err','Enter a valid email.'); ok=false; } else clearErr('su_email_err');
  if (!pass || pass.length < 6)  { setErr('su_pass_err','Min 6 characters.'); ok=false; } else clearErr('su_pass_err');
  if (!ok) return;

  const users = getUsers();
  if (users.find(u => u.email === email)) {
    setErr('su_email_err','An account with this email already exists.'); return;
  }

  currentUser = {
    id: uid(), name, email, password: simpleHash(pass),
    dob: val('su_dob'), blood: val('su_blood'),
    phone:'', allergies:'', emergency:'', avatar:'',
    createdAt: new Date().toISOString()
  };
  users.push(currentUser);
  localStorage.setItem('px_users', JSON.stringify(users));
  saveCurrentUser();
  db = { prescriptions:[], doctors:[], notes:[], reminders:[], family:[], notifications:[] };
  saveDB();
  showApp();
  toast('Welcome to Prescrix, ' + firstName(name) + '!', 'success');
}

function doLogout() {
  currentUser = null;
  localStorage.removeItem('px_current_user');
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('authScreen').style.display = 'flex';
  document.getElementById('li_email').value = '';
  document.getElementById('li_pass').value  = '';
  clearAuthErrs();
  toast('Logged out.');
}

// ======================== SHOW APP ========================
function showApp() {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('appShell').style.display   = 'flex';
  refreshUI();
  goPage('dashboard');
  checkTodayReminders();
}

function refreshUI() {
  const name = currentUser.name || 'User';
  const ini  = initials(name);
  const avi  = currentUser.avatar
    ? `<img src="${currentUser.avatar}" alt="${esc(name)}">`
    : ini;

  document.getElementById('sbName').textContent   = name;
  document.getElementById('sbAvatar').innerHTML   = avi;
  document.getElementById('tbAvatar').innerHTML   = avi;

  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const gEl = document.getElementById('greeting');
  if (gEl) gEl.textContent = greet + ', ' + firstName(name) + ' 👋';
  const dEl = document.getElementById('todayDate');
  if (dEl) dEl.textContent = new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});

  updateStats();
  populateProfileForm();
  refreshNotifications();
}

// ======================== LOCAL DB ========================
function loadDB() {
  try {
    const raw = localStorage.getItem('px_db_' + currentUser.id);
    if (raw) {
      db = JSON.parse(raw);
      if (!db.notifications) db.notifications = [];
      if (!db.prescriptions) db.prescriptions = [];
      if (!db.doctors)       db.doctors       = [];
      if (!db.notes)         db.notes         = [];
      if (!db.reminders)     db.reminders     = [];
      if (!db.family)        db.family        = [];
    }
  } catch(e) {
    db = { prescriptions:[], doctors:[], notes:[], reminders:[], family:[], notifications:[] };
  }
}

function saveDB() {
  localStorage.setItem('px_db_' + currentUser.id, JSON.stringify(db));
  updateStats();
}

function updateStats() {
  setText('st-rx',  db.prescriptions.length);
  setText('st-dr',  db.doctors.length);
  setText('st-rem', db.reminders.filter(r => !r.done).length);
  setText('st-fam', db.family.length);

  const due = db.reminders.filter(r => !r.done && r.date === todayStr()).length;
  const badge = document.getElementById('reminderBadge');
  if (badge) { badge.textContent = due; badge.style.display = due > 0 ? 'inline' : 'none'; }
}

// ======================== NAVIGATION ========================
function goPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nitem[data-page]').forEach(n => n.classList.remove('active'));

  const page = document.getElementById('page-' + name);
  if (page) page.classList.add('active');
  const nav = document.querySelector(`.nitem[data-page="${name}"]`);
  if (nav) nav.classList.add('active');

  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.remove('open');
  }

  const fn = {
    dashboard:     renderDashboard,
    prescriptions: renderPrescriptions,
    doctors:       renderDoctors,
    notes:         renderNotes,
    timeline:      renderTimeline,
    reminders:     renderReminders,
    family:        renderFamily
  };
  if (fn[name]) fn[name]();
}

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ma = document.getElementById('mainArea');
  if (window.innerWidth <= 768) {
    sb.classList.toggle('open');
  } else {
    const hidden = sb.classList.toggle('hidden');
    if (ma) ma.style.marginLeft = hidden ? '0' : 'var(--sw)';
  }
}

// ======================== DASHBOARD ========================
function renderDashboard() {
  updateStats();
  populateDrDropdowns();

  // Recent Rx
  const rxEl = document.getElementById('dash-rx');
  if (rxEl) {
    const list = [...db.prescriptions].sort((a,b) => new Date(b.date||0) - new Date(a.date||0)).slice(0,4);
    rxEl.innerHTML = list.length
      ? list.map(rx => `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="viewPrescription('${rx.id}')">
            <span style="font-size:22px">📄</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:14px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(rx.title)}</div>
              <div style="font-size:12px;color:var(--text3)">${fmtDate(rx.date)}</div>
            </div>
            <span class="rx-status-badge status-${rx.status||'active'}">${rx.status||'active'}</span>
          </div>`)
        .join('')
      : '<div class="empty-msg">No prescriptions yet.</div>';
  }

  // Today Reminders
  const remEl = document.getElementById('dash-rem');
  if (remEl) {
    const today = db.reminders.filter(r => !r.done && r.date === todayStr());
    remEl.innerHTML = today.length
      ? today.map(r => `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:20px">${remIcon(r.type)}</span>
            <div style="flex:1">
              <div style="font-size:14px;font-weight:500;color:var(--text)">${esc(r.title)}</div>
              <div style="font-size:12px;color:var(--text3)">${r.time ? fmtTime(r.time) : 'All day'}</div>
            </div>
            <button class="rem-done-btn ${r.done?'done':''}" onclick="toggleRemDone('${r.id}')" title="Mark done">✓</button>
          </div>`)
        .join('')
      : '<div class="empty-msg">No reminders for today.</div>';
  }

  // Doctors
  const drEl = document.getElementById('dash-dr');
  if (drEl) {
    drEl.innerHTML = db.doctors.length
      ? db.doctors.slice(0,4).map(d => `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
            <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--blue),#3b82f6);color:#fff;font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center;flex-shrink:0">${initials(d.name)}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:14px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.name)}</div>
              <div style="font-size:12px;color:var(--text3)">${esc(d.specialization||'General')}</div>
            </div>
          </div>`)
        .join('')
      : '<div class="empty-msg">No doctors added yet.</div>';
  }

  // Notes
  const notesEl = document.getElementById('dash-notes');
  if (notesEl) {
    const list = [...db.notes].sort((a,b) => new Date(b.date||0) - new Date(a.date||0)).slice(0,4);
    notesEl.innerHTML = list.length
      ? list.map(n => `
          <div style="padding:10px 0;border-bottom:1px solid var(--border)">
            <div style="font-size:14px;font-weight:500;color:var(--text)">${esc(n.title)}</div>
            <div style="font-size:12px;color:var(--text3)">${fmtDate(n.date)}${n.doctorName?' · '+esc(n.doctorName):''}</div>
          </div>`)
        .join('')
      : '<div class="empty-msg">No visit notes yet.</div>';
  }
}

// ======================== PRESCRIPTIONS ========================
function savePrescription() {
  const title = val('rx_title');
  const date  = val('rx_date');
  let ok = true;
  if (!title) { setErr('rx_title_err','Title is required.'); ok=false; } else clearErr('rx_title_err');
  if (!date)  { setErr('rx_date_err','Date is required.'); ok=false; }  else clearErr('rx_date_err');
  if (!ok) return;

  const drId = val('rx_doctor');
  const dr   = db.doctors.find(d => d.id === drId);
  const fileData = getFileData('rxFile');

  const rx = {
    id: uid(),
    title,
    doctorId:   drId,
    doctorName: dr ? dr.name : '',
    date,
    expiry:    val('rx_expiry'),
    diagnosis: val('rx_diagnosis'),
    status:    val('rx_status') || 'active',
    notes:     val('rx_notes'),
    member:    val('rx_member'),
    file:      fileData,
    createdAt: new Date().toISOString()
  };

  db.prescriptions.push(rx);
  pushNotif('New prescription added: ' + rx.title);
  saveDB();
  closeModal('upRxModal');
  resetForm('upRxModal');
  toast('Prescription saved!', 'success');
  renderDashboard();
  if (activePage() === 'prescriptions') renderPrescriptions();
}

function renderPrescriptions() {
  const el = document.getElementById('rxGrid');
  if (!el) return;
  let list = [...db.prescriptions];
  if (rxFilter !== 'all') list = list.filter(r => r.status === rxFilter);
  if      (rxSort === 'date-asc')  list.sort((a,b) => new Date(a.date||0) - new Date(b.date||0));
  else if (rxSort === 'doctor')    list.sort((a,b) => (a.doctorName||'').localeCompare(b.doctorName||''));
  else                             list.sort((a,b) => new Date(b.date||0) - new Date(a.date||0));

  if (!list.length) { el.innerHTML = emptyState('📄','No prescriptions found','Upload your first prescription to get started'); return; }

  el.innerHTML = list.map(rx => `
    <div class="rx-card" onclick="viewPrescription('${rx.id}')">
      <div class="rx-card-top">
        <div class="rx-card-icon">${rx.file && rx.file.type==='pdf' ? '📋' : '📄'}</div>
        <span class="rx-status-badge status-${rx.status||'active'}">${rx.status||'active'}</span>
      </div>
      <div class="rx-card-title">${esc(rx.title)}</div>
      ${rx.diagnosis  ? `<div class="rx-card-meta">🩺 ${esc(rx.diagnosis)}</div>` : ''}
      ${rx.doctorName ? `<div class="rx-card-meta">👨‍⚕️ ${esc(rx.doctorName)}</div>` : ''}
      ${rx.expiry     ? `<div class="rx-card-meta">📅 Expires: ${fmtDate(rx.expiry)}</div>` : ''}
      <div class="rx-card-date">Added ${fmtDate(rx.date)}</div>
    </div>`).join('');
}

function viewPrescription(id) {
  const rx = db.prescriptions.find(r => r.id === id);
  if (!rx) { toast('Prescription not found.','error'); return; }

  const title = document.getElementById('viewRxTitle');
  const body  = document.getElementById('viewRxBody');
  const delBtn = document.getElementById('delRxBtn');
  if (!title || !body || !delBtn) return;

  title.textContent = rx.title;

  let html = '<div>';
  html += dRow('Status', `<span class="rx-status-badge status-${rx.status||'active'}">${rx.status||'active'}</span>`);
  if (rx.date)       html += dRow('Date', fmtDate(rx.date));
  if (rx.expiry)     html += dRow('Expiry Date', fmtDate(rx.expiry));
  if (rx.diagnosis)  html += dRow('Diagnosis', esc(rx.diagnosis));
  if (rx.doctorName) html += dRow('Doctor', esc(rx.doctorName));
  if (rx.member)     html += dRow('For Member', esc(rx.member));
  if (rx.notes)      html += dRow('Notes', `<span style="white-space:pre-wrap">${esc(rx.notes)}</span>`);
  html += '</div>';

  if (rx.file) {
    if (rx.file.type === 'image') {
      html += `<img src="${rx.file.data}" class="detail-img" alt="Prescription image">`;
    } else {
      html += `<a href="${rx.file.data}" download="prescription.pdf" style="display:inline-flex;align-items:center;gap:8px;margin-top:14px;padding:10px 16px;background:var(--teal-l);color:var(--teal);border-radius:8px;text-decoration:none;font-size:14px;font-weight:500">📋 Download PDF</a>`;
    }
  }

  body.innerHTML = html;

  // Assign delete button handler
  delBtn.onclick = async function() {
    const confirmed = await confirm2('Delete Prescription', `Delete "${rx.title}"? This cannot be undone.`);
    if (confirmed) {
      db.prescriptions = db.prescriptions.filter(r => r.id !== id);
      saveDB();
      closeModal('viewRxModal');
      toast('Prescription deleted.', 'warning');
      renderDashboard();
      if (activePage() === 'prescriptions') renderPrescriptions();
    }
  };

  openModal('viewRxModal');
}

function filterRx(f, btn) {
  rxFilter = f;
  document.querySelectorAll('.fbtn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderPrescriptions();
}
function sortRx(v) { rxSort = v; renderPrescriptions(); }

// ======================== DOCTORS ========================
function saveDoctor() {
  const name = val('dr_name');
  if (!name) { setErr('dr_name_err','Doctor name is required.'); return; }
  clearErr('dr_name_err');

  const appt = val('dr_appt');
  const dr = {
    id: uid(), name,
    specialization: val('dr_spec'),
    phone:    val('dr_phone'),
    email:    val('dr_email'),
    hospital: val('dr_hospital'),
    address:  val('dr_address'),
    nextAppointment: appt,
    notes:    val('dr_notes'),
    createdAt: new Date().toISOString()
  };

  if (appt) {
    db.reminders.push({ id:uid(), title:`Appointment with ${dr.name}`, type:'appointment', date:appt, time:'', freq:'once', notes:dr.hospital||'', done:false, createdAt:new Date().toISOString() });
    pushNotif(`Appointment reminder set: ${dr.name} on ${fmtDate(appt)}`);
  }

  db.doctors.push(dr);
  saveDB();
  populateDrDropdowns();
  closeModal('addDrModal');
  resetForm('addDrModal');
  toast('Doctor added!', 'success');
  renderDashboard();
  if (activePage() === 'doctors') renderDoctors();
}

function renderDoctors() {
  const el = document.getElementById('doctorsGrid');
  if (!el) return;
  if (!db.doctors.length) { el.innerHTML = emptyState('👨‍⚕️','No doctors added','Add your healthcare providers'); return; }
  el.innerHTML = db.doctors.map(d => `
    <div class="dr-card">
      <div class="dr-avatar">${initials(d.name)}</div>
      <div class="dr-name">${esc(d.name)}</div>
      <div class="dr-spec">${esc(d.specialization||'General Practitioner')}</div>
      ${d.phone    ? `<div class="dr-info">📞 <a href="tel:${esc(d.phone)}">${esc(d.phone)}</a></div>` : ''}
      ${d.email    ? `<div class="dr-info">✉️ <a href="mailto:${esc(d.email)}">${esc(d.email)}</a></div>` : ''}
      ${d.hospital ? `<div class="dr-info">🏥 ${esc(d.hospital)}</div>` : ''}
      ${d.address  ? `<div class="dr-info">📍 ${esc(d.address)}</div>` : ''}
      ${d.nextAppointment ? `<div class="dr-info" style="color:var(--amber);font-weight:500">📅 Next: ${fmtDate(d.nextAppointment)}</div>` : ''}
      ${d.notes    ? `<div style="font-size:13px;color:var(--text2);margin-top:8px;background:var(--bg);padding:8px;border-radius:6px">${esc(d.notes)}</div>` : ''}
      <div class="dr-actions">
        <button type="button" class="act-del" onclick="deleteDoctor('${d.id}')">Delete</button>
      </div>
    </div>`).join('');
}

async function deleteDoctor(id) {
  const d = db.doctors.find(x => x.id === id);
  if (!d) return;
  const ok = await confirm2('Delete Doctor', `Remove ${d.name} from your doctors?`);
  if (!ok) return;
  db.doctors = db.doctors.filter(x => x.id !== id);
  saveDB();
  populateDrDropdowns();
  renderDoctors();
  toast('Doctor removed.', 'warning');
}

// ======================== NOTES ========================
function saveNote() {
  const title = val('note_title');
  if (!title) { setErr('note_title_err','Title is required.'); return; }
  clearErr('note_title_err');

  const drId   = val('note_doctor');
  const dr     = db.doctors.find(d => d.id === drId);
  const followup = val('note_followup');

  const note = {
    id: uid(), title,
    doctorId:   drId,
    doctorName: dr ? dr.name : '',
    date:         val('note_date') || todayStr(),
    diagnosis:    val('note_diagnosis'),
    symptoms:     val('note_symptoms'),
    instructions: val('note_instructions'),
    medicines:    val('note_medicines'),
    followup,
    createdAt: new Date().toISOString()
  };

  if (followup) {
    db.reminders.push({ id:uid(), title:`Follow-up: ${note.title}`, type:'appointment', date:followup, time:'', freq:'once', notes:note.doctorName||'', done:false, createdAt:new Date().toISOString() });
    pushNotif(`Follow-up reminder set for ${fmtDate(followup)}`);
  }

  db.notes.push(note);
  saveDB();
  closeModal('addNoteModal');
  resetForm('addNoteModal');
  toast('Note saved!', 'success');
  renderDashboard();
  if (activePage() === 'notes') renderNotes();
}

function renderNotes() {
  const el = document.getElementById('notesList');
  if (!el) return;
  if (!db.notes.length) { el.innerHTML = emptyState('📝','No visit notes','Record what your doctor said during each visit'); return; }

  const sorted = [...db.notes].sort((a,b) => new Date(b.date||0) - new Date(a.date||0));
  el.innerHTML = sorted.map(n => {
    const sections = [
      n.diagnosis    && ['DIAGNOSIS',    n.diagnosis],
      n.symptoms     && ['SYMPTOMS',     n.symptoms],
      n.instructions && ['INSTRUCTIONS', n.instructions],
      n.medicines    && ['MEDICINES',    n.medicines],
    ].filter(Boolean);
    return `
    <div class="note-card">
      <div class="note-head">
        <div>
          <div class="note-title">${esc(n.title)}</div>
          <div class="note-meta">${fmtDate(n.date)}${n.doctorName?' · '+esc(n.doctorName):''}</div>
        </div>
        <button type="button" class="act-del" onclick="deleteNote('${n.id}')">Delete</button>
      </div>
      ${sections.map(([lbl,txt]) => `<div><div class="note-section-label">${lbl}</div><div class="note-section-text">${esc(txt)}</div></div>`).join('')}
      ${n.followup ? `<div style="font-size:13px;background:var(--amber-l);color:var(--amber);padding:8px 12px;border-radius:6px;font-weight:500;margin-top:8px">📅 Follow-up: ${fmtDate(n.followup)}</div>` : ''}
    </div>`;
  }).join('');
}

async function deleteNote(id) {
  const ok = await confirm2('Delete Note','Delete this visit note? This cannot be undone.');
  if (!ok) return;
  db.notes = db.notes.filter(n => n.id !== id);
  saveDB();
  renderNotes();
  toast('Note deleted.', 'warning');
}

// ======================== TIMELINE ========================
function renderTimeline() {
  const el = document.getElementById('timelineWrap');
  if (!el) return;
  const items = [];

  db.prescriptions.forEach(r => items.push({ date:r.date, type:'rx',   badge:'tl-rx',   label:'📄 Prescription', title:r.title, sub:r.doctorName?'Prescribed by '+r.doctorName:'' }));
  db.notes.forEach(n        => items.push({ date:n.date, type:'note', badge:'tl-note', label:'📝 Visit Note',    title:n.title, sub:n.diagnosis||n.doctorName||'' }));
  db.reminders.forEach(r    => items.push({ date:r.date, type:'rem',  badge:'tl-rem',  label:remLabel(r.type),  title:r.title, sub:r.time?'At '+fmtTime(r.time):'' }));

  items.sort((a,b) => new Date(b.date||0) - new Date(a.date||0));

  if (!items.length) { el.innerHTML = emptyState('🕐','No history yet','Your timeline will appear here as you add records'); return; }

  el.innerHTML = items.map(i => `
    <div class="tl-item">
      <div class="tl-dot"></div>
      <div class="tl-card">
        <div class="tl-date">${fmtDate(i.date)}</div>
        <span class="tl-type-badge ${i.badge}">${i.label}</span>
        <div class="tl-title">${esc(i.title)}</div>
        ${i.sub ? `<div class="tl-sub">${esc(i.sub)}</div>` : ''}
      </div>
    </div>`).join('');
}

// ======================== REMINDERS ========================
function saveReminder() {
  const title = val('rem_title');
  const date  = val('rem_date');
  if (!title) { setErr('rem_title_err','Title is required.'); return; }
  clearErr('rem_title_err');
  if (!date)  { toast('Please select a date.','error'); return; }

  const rem = {
    id: uid(), title,
    type:  val('rem_type')  || 'medicine',
    date,
    time:  val('rem_time'),
    freq:  val('rem_freq')  || 'once',
    notes: val('rem_notes'),
    done:  false,
    createdAt: new Date().toISOString()
  };

  db.reminders.push(rem);
  pushNotif(`Reminder set: ${rem.title} on ${fmtDate(rem.date)}`);
  saveDB();
  closeModal('addRemModal');
  resetForm('addRemModal');
  toast('Reminder added!', 'success');
  renderDashboard();
  if (activePage() === 'reminders') renderReminders();
}

function renderReminders() {
  const el = document.getElementById('remList');
  if (!el) return;
  if (!db.reminders.length) { el.innerHTML = emptyState('🔔','No reminders','Set reminders so you never miss a dose or appointment'); return; }

  const today = todayStr();
  const sorted = [...db.reminders].sort((a,b) => new Date(a.date||0) - new Date(b.date||0));

  el.innerHTML = sorted.map(r => {
    let cls = '';
    if (r.date < today && !r.done) cls = 'rem-overdue';
    else if (r.date === today)      cls = 'rem-today';
    return `
    <div class="rem-card ${cls}" style="${r.done?'opacity:0.55':''}">
      <div class="rem-icon">${remIcon(r.type)}</div>
      <div class="rem-body">
        <div class="rem-title" style="${r.done?'text-decoration:line-through':''}">${esc(r.title)}</div>
        <div class="rem-meta">
          ${fmtDate(r.date)}${r.time?' at '+fmtTime(r.time):''}
          · ${capitalize(r.freq||'once')}
          ${r.date < today && !r.done ? ' · <span style="color:var(--danger);font-weight:500">Overdue</span>' : ''}
          ${r.date === today && !r.done ? ' · <span style="color:var(--amber);font-weight:500">Today</span>' : ''}
        </div>
        ${r.notes ? `<div style="font-size:12px;color:var(--text3);margin-top:3px">${esc(r.notes)}</div>` : ''}
      </div>
      <div class="rem-actions">
        <button type="button" class="rem-done-btn ${r.done?'done':''}" onclick="toggleRemDone('${r.id}')" title="${r.done?'Mark undone':'Mark done'}">✓</button>
        <button type="button" class="act-del" onclick="deleteReminder('${r.id}')">✕</button>
      </div>
    </div>`;
  }).join('');
}

function toggleRemDone(id) {
  const r = db.reminders.find(x => x.id === id);
  if (!r) return;
  r.done = !r.done;
  saveDB();
  renderReminders();
  renderDashboard();
  toast(r.done ? 'Marked as done.' : 'Marked as pending.');
}

async function deleteReminder(id) {
  const ok = await confirm2('Delete Reminder','Delete this reminder?');
  if (!ok) return;
  db.reminders = db.reminders.filter(r => r.id !== id);
  saveDB();
  renderReminders();
  toast('Reminder deleted.', 'warning');
}

// ======================== FAMILY ========================
function saveFamilyMember() {
  const name = val('fam_name');
  if (!name) { setErr('fam_name_err','Name is required.'); return; }
  clearErr('fam_name_err');

  const member = {
    id: uid(), name,
    relationship: val('fam_rel'),
    dob:          val('fam_dob'),
    blood:        val('fam_blood'),
    allergies:    val('fam_allergies'),
    conditions:   val('fam_conditions'),
    createdAt: new Date().toISOString()
  };

  db.family.push(member);
  saveDB();
  populateDrDropdowns();
  closeModal('addFamModal');
  resetForm('addFamModal');
  toast('Family member added!', 'success');
  renderDashboard();
  if (activePage() === 'family') renderFamily();
}

function renderFamily() {
  const el = document.getElementById('famGrid');
  if (!el) return;
  if (!db.family.length) { el.innerHTML = emptyState('👨‍👩‍👧','No family members','Add family members to manage their records'); return; }

  el.innerHTML = db.family.map(f => {
    const age = f.dob ? Math.floor((Date.now() - new Date(f.dob)) / (365.25*24*3600*1000)) : null;
    return `
    <div class="fam-card">
      <div class="fam-avatar">${initials(f.name)}</div>
      <div class="fam-name">${esc(f.name)}</div>
      ${f.relationship ? `<div class="fam-rel">${esc(f.relationship)}</div>` : ''}
      ${age !== null   ? `<div class="fam-detail">🎂 ${age} years old</div>` : ''}
      ${f.blood        ? `<div class="fam-detail">🩸 Blood group: ${esc(f.blood)}</div>` : ''}
      ${f.allergies    ? `<div class="fam-detail">⚠️ Allergies: ${esc(f.allergies)}</div>` : ''}
      ${f.conditions   ? `<div class="fam-detail" style="font-size:12px;color:var(--text3);margin-top:6px">${esc(f.conditions)}</div>` : ''}
      <div class="fam-actions">
        <button type="button" class="act-del" onclick="deleteFamilyMember('${f.id}')">Remove</button>
      </div>
    </div>`;
  }).join('');
}

async function deleteFamilyMember(id) {
  const f = db.family.find(m => m.id === id);
  if (!f) return;
  const ok = await confirm2('Remove Member', `Remove ${f.name} from family profiles?`);
  if (!ok) return;
  db.family = db.family.filter(m => m.id !== id);
  saveDB();
  renderFamily();
  toast('Family member removed.', 'warning');
}

// ======================== PROFILE ========================
function populateProfileForm() {
  if (!currentUser) return;
  setInputVal('p_name',      currentUser.name      || '');
  setInputVal('p_email',     currentUser.email     || '');
  setInputVal('p_phone',     currentUser.phone     || '');
  setInputVal('p_dob',       currentUser.dob       || '');
  setInputVal('p_blood',     currentUser.blood     || '');
  setInputVal('p_allergies', currentUser.allergies || '');
  setInputVal('p_emergency', currentUser.emergency || '');

  const avi = document.getElementById('profileAvatar');
  if (avi) {
    avi.innerHTML = currentUser.avatar
      ? `<img src="${currentUser.avatar}" alt="${esc(currentUser.name)}">`
      : initials(currentUser.name || 'U');
  }
}

function saveProfile() {
  const name = val('p_name');
  if (!name) { toast('Name cannot be empty.','error'); return; }
  currentUser.name      = name;
  currentUser.phone     = val('p_phone');
  currentUser.dob       = val('p_dob');
  currentUser.blood     = val('p_blood');
  currentUser.allergies = val('p_allergies');
  currentUser.emergency = val('p_emergency');
  persistUser();
  refreshUI();
  toast('Profile updated!', 'success');
}

function uploadAvatar(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (file.size > 2*1024*1024) { toast('Image must be under 2MB.','error'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    currentUser.avatar = e.target.result;
    persistUser();
    refreshUI();
    populateProfileForm();
    toast('Photo updated!', 'success');
  };
  reader.readAsDataURL(file);
}

function changePassword() {
  const np = val('p_newpass');
  const cp = val('p_confirmpass');
  if (!np || np.length < 6) { toast('Password must be at least 6 characters.','error'); return; }
  if (np !== cp)             { toast('Passwords do not match.','error'); return; }
  currentUser.password = simpleHash(np);
  persistUser();
  setInputVal('p_newpass','');
  setInputVal('p_confirmpass','');
  toast('Password updated!', 'success');
}

async function deleteAllData() {
  const ok = await confirm2('Delete All Data','This will permanently delete ALL your prescriptions, doctors, notes, reminders, and family members. This cannot be undone.');
  if (!ok) return;
  db = { prescriptions:[], doctors:[], notes:[], reminders:[], family:[], notifications:[] };
  saveDB();
  toast('All data deleted.', 'warning');
  goPage('dashboard');
}

function persistUser() {
  saveCurrentUser();
  const users = getUsers();
  const idx = users.findIndex(u => u.id === currentUser.id);
  if (idx >= 0) users[idx] = currentUser;
  else users.push(currentUser);
  localStorage.setItem('px_users', JSON.stringify(users));
}

// ======================== NOTIFICATIONS ========================
function pushNotif(msg) {
  if (!db.notifications) db.notifications = [];
  db.notifications.unshift({ id:uid(), msg, time:new Date().toISOString(), read:false });
  if (db.notifications.length > 30) db.notifications = db.notifications.slice(0,30);
  refreshNotifications();
}

function refreshNotifications() {
  const el  = document.getElementById('notifList');
  const dot = document.getElementById('notifDot');
  if (!db.notifications) db.notifications = [];

  const unread = db.notifications.filter(n => !n.read).length;
  if (dot) dot.style.display = unread > 0 ? 'block' : 'none';

  if (!el) return;
  if (!db.notifications.length) { el.innerHTML = '<p class="empty-msg">No notifications yet.</p>'; return; }

  el.innerHTML = db.notifications.slice(0,12).map(n => `
    <div class="notif-item ${n.read?'':'unread'}" onclick="readNotif('${n.id}')">
      ${esc(n.msg)}
      <div style="font-size:11px;color:var(--text3);margin-top:3px">${timeAgo(n.time)}</div>
    </div>`).join('');
}

function readNotif(id) {
  const n = db.notifications.find(x => x.id === id);
  if (n) n.read = true;
  saveDB();
  refreshNotifications();
}

function toggleNotif() {
  const panel = document.getElementById('notifPanel');
  if (!panel) return;
  const visible = panel.style.display !== 'none';
  panel.style.display = visible ? 'none' : 'block';
  if (!visible) {
    // Mark all read when opening
    if (db.notifications) db.notifications.forEach(n => n.read = true);
    saveDB();
    refreshNotifications();
  }
}

function checkTodayReminders() {
  const today = todayStr();
  let changed = false;
  db.reminders.forEach(r => {
    if (!r.done && r.date === today && !r._notifiedToday) {
      r._notifiedToday = true;
      pushNotif(`⏰ Reminder today: ${r.title}${r.time?' at '+fmtTime(r.time):''}`);
      changed = true;
    }
  });
  if (changed) saveDB();
}

// ======================== SEARCH ========================
function globalSearch(query) {
  const drop = document.getElementById('searchDrop');
  if (!drop) return;
  if (!query || query.trim().length < 2) { drop.style.display='none'; drop.innerHTML=''; searchResultsCache=[]; return; }

  const q = query.toLowerCase();
  const results = [];

  db.prescriptions
    .filter(r => r.title.toLowerCase().includes(q) || (r.diagnosis||'').toLowerCase().includes(q) || (r.doctorName||'').toLowerCase().includes(q))
    .forEach(r => results.push({ icon:'📄', text:r.title, sub:r.doctorName||fmtDate(r.date), action:() => { closeSearchAndGo(); viewPrescription(r.id); } }));

  db.doctors
    .filter(d => d.name.toLowerCase().includes(q) || (d.specialization||'').toLowerCase().includes(q))
    .forEach(d => results.push({ icon:'👨‍⚕️', text:d.name, sub:d.specialization||d.hospital||'', action:() => { closeSearchAndGo(); goPage('doctors'); } }));

  db.notes
    .filter(n => n.title.toLowerCase().includes(q) || (n.diagnosis||'').toLowerCase().includes(q))
    .forEach(n => results.push({ icon:'📝', text:n.title, sub:fmtDate(n.date), action:() => { closeSearchAndGo(); goPage('notes'); } }));

  db.reminders
    .filter(r => r.title.toLowerCase().includes(q))
    .forEach(r => results.push({ icon:remIcon(r.type), text:r.title, sub:fmtDate(r.date), action:() => { closeSearchAndGo(); goPage('reminders'); } }));

  searchResultsCache = results;

  if (!results.length) {
    drop.innerHTML = '<div class="empty-msg">No results found.</div>';
  } else {
    drop.innerHTML = results.slice(0,8).map((r,i) => `
      <div class="search-item" onclick="searchResultsCache[${i}].action()">
        <div class="search-item-icon">${r.icon}</div>
        <div>
          <div class="search-item-text">${esc(r.text)}</div>
          <div class="search-item-sub">${esc(r.sub)}</div>
        </div>
      </div>`).join('');
  }
  drop.style.display = 'block';
}

function closeSearchAndGo() {
  hideSearchDrop();
}
function hideSearchDrop() {
  const drop = document.getElementById('searchDrop');
  const inp  = document.getElementById('gSearch');
  if (drop) { drop.style.display='none'; drop.innerHTML=''; }
  if (inp)  inp.value = '';
  searchResultsCache = [];
}

// ======================== FILE HANDLING ========================
function previewFile(input, previewId) {
  const file = input && input.files && input.files[0];
  if (!file) return;
  if (file.size > 10*1024*1024) { toast('File must be under 10MB.','error'); input.value=''; return; }
  const prev = document.getElementById(previewId);
  const reader = new FileReader();
  reader.onload = e => {
    input._fileData = { data:e.target.result, type:file.type.startsWith('image')?'image':'pdf', name:file.name };
    if (prev) {
      prev.innerHTML = file.type.startsWith('image')
        ? `<img src="${e.target.result}" style="max-height:80px;border-radius:6px;margin-right:8px"><span>${esc(file.name)}</span>`
        : `<span style="font-size:20px">📋</span><span>${esc(file.name)}</span>`;
      prev.style.display = 'flex';
    }
  };
  reader.readAsDataURL(file);
}

function getFileData(inputId) {
  const inp = document.getElementById(inputId);
  return inp && inp._fileData ? inp._fileData : null;
}

function dragOver(e) { e.preventDefault(); e.currentTarget.classList.add('dragover'); }

function dropFile(e, inputId, previewId) {
  e.preventDefault();
  e.currentTarget.classList.remove('dragover');
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  const inp = document.getElementById(inputId);
  if (!inp) return;
  const dt = new DataTransfer();
  dt.items.add(file);
  inp.files = dt.files;
  previewFile(inp, previewId);
}

// ======================== MODALS ========================
function openModal(id) {
  const el = document.getElementById(id);
  if (!el) { console.warn('Modal not found:', id); return; }

  // Populate dropdowns if needed
  if (id === 'upRxModal' || id === 'addNoteModal') populateDrDropdowns();

  el.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';

  // Only restore scroll if no other modal is open
  const anyOpen = [...document.querySelectorAll('.modal-backdrop')]
    .some(m => m.style.display !== 'none');
  if (!anyOpen) document.body.style.overflow = '';
}

function bgClose(event, id) {
  // Close only when clicking the dark backdrop itself, not the modal box
  if (event.target.id === id) closeModal(id);
}

// ======================== CONFIRM DIALOG ========================
function confirm2(title, msg) {
  return new Promise(resolve => {
    setText('confirmTitle', title);
    const msgEl = document.getElementById('confirmMsg');
    if (msgEl) msgEl.textContent = msg;
    document.getElementById('confirmModal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
    pendingConfirm = resolve;
  });
}

function resolveConfirm(val) {
  document.getElementById('confirmModal').style.display = 'none';
  const anyOpen = [...document.querySelectorAll('.modal-backdrop')]
    .some(m => m.style.display !== 'none');
  if (!anyOpen) document.body.style.overflow = '';
  if (pendingConfirm) { pendingConfirm(val); pendingConfirm = null; }
}

// ======================== TOAST ========================
let _toastTimer = null;
function toast(msg, type='') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show' + (type?' '+type:'');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// ======================== FORM HELPERS ========================
function populateDrDropdowns() {
  const drOpts = '<option value="">Select doctor</option>'
    + db.doctors.map(d => `<option value="${d.id}">${esc(d.name)}${d.specialization?' ('+esc(d.specialization)+')':''}</option>`).join('');

  ['rx_doctor','note_doctor'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = drOpts;
  });

  const famOpts = '<option value="">Self</option>'
    + db.family.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('');
  const rxMem = document.getElementById('rx_member');
  if (rxMem) rxMem.innerHTML = famOpts;
}

function resetForm(modalId) {
  // Reset all inputs/selects/textareas inside this modal's body
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.querySelectorAll('input[type="text"],input[type="email"],input[type="tel"],input[type="date"],input[type="time"],input[type="password"],textarea').forEach(el => {
    if (!el.readOnly) el.value = '';
  });
  modal.querySelectorAll('select').forEach(el => el.selectedIndex = 0);
  modal.querySelectorAll('.ferr').forEach(el => el.textContent = '');
  modal.querySelectorAll('.file-preview').forEach(el => { el.style.display='none'; el.innerHTML=''; });
  modal.querySelectorAll('input[type="file"]').forEach(el => { el.value=''; el._fileData=null; });

  // Re-set today for date fields
  const today = todayStr();
  modal.querySelectorAll('input[type="date"]').forEach(el => {
    if (!el.id.includes('expiry') && !el.id.includes('appt') && !el.id.includes('followup') && !el.id.includes('dob')) {
      el.value = today;
    }
  });

  // Restore default select values
  const statusSel = modal.querySelector('#rx_status');
  if (statusSel) statusSel.value = 'active';
  const typeSel = modal.querySelector('#rem_type');
  if (typeSel) typeSel.value = 'medicine';
  const freqSel = modal.querySelector('#rem_freq');
  if (freqSel) freqSel.value = 'once';
}

// ======================== UTILITIES ========================
function uid()     { return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }
function val(id)   { const e=document.getElementById(id); return e ? e.value.trim() : ''; }
function setInputVal(id,v) { const e=document.getElementById(id); if(e) e.value=v; }
function setText(id,v)     { const e=document.getElementById(id); if(e) e.textContent=v; }
function setErr(id,msg)    { const e=document.getElementById(id); if(e) e.textContent=msg; }
function clearErr(id)      { const e=document.getElementById(id); if(e) e.textContent=''; }
function isEmail(s)        { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }
function todayStr()        { return new Date().toISOString().split('T')[0]; }
function activePage()      { const p=document.querySelector('.page.active'); return p?p.id.replace('page-',''):''; }
function firstName(name)   { return (name||'').split(' ')[0]; }
function capitalize(s)     { return s ? s[0].toUpperCase()+s.slice(1) : ''; }
function initials(name)    { if(!name) return '?'; return name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2); }
function esc(s)            { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function fmtDate(s) {
  if (!s) return '';
  try { return new Date(s+'T12:00:00').toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'}); }
  catch { return s; }
}
function fmtTime(s) {
  if (!s) return '';
  const [h,m] = s.split(':').map(Number);
  return `${h>12?h-12:h||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`;
}
function timeAgo(iso) {
  const diff = Date.now() - new Date(iso);
  const mins = Math.floor(diff/60000);
  if (mins < 1)   return 'Just now';
  if (mins < 60)  return mins+'m ago';
  const h = Math.floor(mins/60);
  if (h < 24) return h+'h ago';
  return Math.floor(h/24)+'d ago';
}
function remIcon(type)  { return {medicine:'💊',appointment:'📅',test:'🧪',other:'📌'}[type]||'🔔'; }
function remLabel(type) { return {medicine:'💊 Medicine',appointment:'📅 Appointment',test:'🧪 Lab Test',other:'📌 Other'}[type]||'🔔 Reminder'; }

function dRow(label, valueHtml) {
  return `<div class="detail-row"><div class="detail-label">${label}</div><div class="detail-value">${valueHtml}</div></div>`;
}
function emptyState(icon, title, sub) {
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><div class="empty-title">${title}</div><div class="empty-sub">${sub}</div></div>`;
}

function simpleHash(s) {
  let h = 5381;
  for (let i=0; i<s.length; i++) h = ((h<<5)+h) ^ s.charCodeAt(i);
  return (h>>>0).toString(36);
}

function getUsers()        { try { return JSON.parse(localStorage.getItem('px_users')||'[]'); } catch { return []; } }
function saveCurrentUser() { localStorage.setItem('px_current_user', JSON.stringify(currentUser)); }