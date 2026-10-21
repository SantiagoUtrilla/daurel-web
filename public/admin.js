const config = window.DAUREL_CONFIG || {};
const API = String(config.apiBaseUrl || "").replace(/\/$/, "");
const loginView = document.getElementById("loginView");
const dashboardView = document.getElementById("dashboardView");
const loginForm = document.getElementById("loginForm");
const adminKeyInput = document.getElementById("adminKey");
const loginError = document.getElementById("loginError");
const leadsBody = document.getElementById("leadsBody");
const refreshBtn = document.getElementById("refreshBtn");
const logoutBtn = document.getElementById("logoutBtn");
const statusFilter = document.getElementById("statusFilter");
const searchInput = document.getElementById("searchInput");
const panelMessage = document.getElementById("panelMessage");
const lastUpdated = document.getElementById("lastUpdated");
const detailModal = document.getElementById("detailModal");
const detailTitle = document.getElementById("detailTitle");
const detailGrid = document.getElementById("detailGrid");
const detailSituation = document.getElementById("detailSituation");
const detailKeyAnswer = document.getElementById("detailKeyAnswer");
const detailProfessional = document.getElementById("detailProfessional");
const detailDocuments = document.getElementById("detailDocuments");
const detailPriority = document.getElementById("detailPriority");
const saveDetailBtn = document.getElementById("saveDetailBtn");
const detailError = document.getElementById("detailError");

let leads = [];
let activeLeadId = null;

const labels = {
  new: "Nueva",
  contacted: "Contactada",
  in_attention: "En atención",
  closed: "Cerrada"
};

const followLabels = {
  pending: "Pendiente",
  completed: "Completado"
};

function getKey(){ return sessionStorage.getItem("daurel_admin_key") || ""; }
function authHeaders(){ return {Authorization: `Bearer ${getKey()}`, "Content-Type":"application/json"}; }

function showLogin(message=""){
  dashboardView.classList.add("hidden");
  loginView.classList.remove("hidden");
  loginError.textContent = message;
}

function showDashboard(){
  loginView.classList.add("hidden");
  dashboardView.classList.remove("hidden");
}

async function loadLeads(){
  if(!API){ showLogin("Falta configurar el backend."); return; }
  panelMessage.classList.add("hidden");
  leadsBody.innerHTML = '<tr><td colspan="9" class="empty">Cargando...</td></tr>';

  try{
    const response = await fetch(`${API}/admin/leads`, {headers:authHeaders()});

    if(response.status === 401 || response.status === 403){
      sessionStorage.removeItem("daurel_admin_key");
      showLogin("Clave incorrecta o sesión vencida.");
      return;
    }

    const data = await response.json();

    if(!response.ok || !data.success){
      throw new Error(data.message || "No fue posible cargar las solicitudes.");
    }

    leads = Array.isArray(data.leads) ? data.leads : [];
    showDashboard();
    render();
    lastUpdated.textContent = "Actualizado: " + new Date().toLocaleString("es-MX");
  }catch(error){
    leadsBody.innerHTML = '<tr><td colspan="10" class="empty">No fue posible cargar las solicitudes.</td></tr>';
    panelMessage.textContent = error.message;
    panelMessage.classList.remove("hidden");
  }
}

function render(){
  const filter = statusFilter.value;
  const search = searchInput.value.trim().toLowerCase();

  const visible = leads.filter(lead => {
    if(filter && lead.status !== filter) return false;
    if(!search) return true;

    return [
      lead.request_id,
      lead.name,
      lead.category_internal,
      lead.location,
      lead.professional_assigned
    ].some(value => String(value || "").toLowerCase().includes(search));
  });

  document.getElementById("statNew").textContent = leads.filter(l=>l.status==="new").length;
  document.getElementById("statContacted").textContent = leads.filter(l=>l.status==="contacted").length;
  document.getElementById("statAttention").textContent = leads.filter(l=>l.status==="in_attention").length;
  document.getElementById("statClosed").textContent = leads.filter(l=>l.status==="closed").length;

  if(!visible.length){
    leadsBody.innerHTML = '<tr><td colspan="10" class="empty">No hay solicitudes para mostrar.</td></tr>';
    return;
  }

  leadsBody.innerHTML = visible.map(lead => {
    const wa = lead.whatsapp_e164 ? `https://wa.me/${encodeURIComponent(lead.whatsapp_e164)}` : "#";
    const date = formatDate(lead.created_at);

    return `<tr>
      <td><button class="folio-btn" data-detail-id="${escapeAttr(lead.request_id)}">${escapeHtml(lead.request_id)}</button></td>
      <td>${escapeHtml(lead.name || "—")}</td>
      <td><a class="wa" href="${wa}" target="_blank" rel="noopener">+${escapeHtml(lead.whatsapp_e164 || "")}</a></td>
      <td>${escapeHtml(lead.category_internal || "general")}</td>
      <td>${escapeHtml(lead.urgency || "unknown")}</td>
      <td>${escapeHtml(lead.location || "—")}</td>
      <td><span class="status">${escapeHtml(labels[lead.status] || lead.status || "—")}</span></td>
      <td>${escapeHtml(date)}</td>
      <td><div class="actions">
        <button class="action-btn" data-detail-id="${escapeAttr(lead.request_id)}">Ver</button>
        <button class="action-btn" data-status="contacted" data-id="${escapeAttr(lead.request_id)}">Contactada</button>
        <button class="action-btn primary" data-status="in_attention" data-id="${escapeAttr(lead.request_id)}">En atención</button>
        <button class="action-btn" data-status="closed" data-id="${escapeAttr(lead.request_id)}">Cerrada</button>
      </div></td>
      <td class="priority-dot-cell"><span class="priority-dot ${getPriorityColor(lead)}"></span></td>
    </tr>`;
  }).join("");
}

function openDetail(requestId){
  const lead = leads.find(item => item.request_id === requestId);
  if(!lead) return;

  activeLeadId = requestId;
  detailError.textContent = "";
  detailTitle.textContent = requestId;
  detailSituation.textContent = lead.situation || "Sin descripción.";
  detailKeyAnswer.textContent = lead.key_answer || "Sin respuesta adicional.";
  detailProfessional.value = lead.professional_assigned || "";
  detailDocuments.value = lead.documents_status || "pending";
  detailPriority.value = lead.priority || "normal";

  const items = [
    ["Cliente", lead.name || "—"],
    ["Persona", lead.persona || "—"],
    ["WhatsApp", lead.whatsapp_e164 ? "+" + lead.whatsapp_e164 : "—"],
    ["Categoría", lead.category_internal || "general"],
    ["Urgencia", lead.urgency || "unknown"],
    ["Prioridad", lead.priority || "normal"],
    ["Ubicación", lead.location || "—"],
    ["Estado", labels[lead.status] || lead.status || "—"],
    ["Seguimiento", `${followLabels[lead.follow_up_status] || lead.follow_up_status || "—"} · ${lead.follow_up_count || 0}/2`],
    ["Profesional", lead.professional_assigned || "Sin asignar"],
    ["Documentos", lead.documents_status || "pending"],
    ["Creada", formatDate(lead.created_at)]
  ];

  detailGrid.innerHTML = items.map(([label, value]) => `
    <div class="detail-item">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join("");

  detailModal.classList.remove("hidden");
  detailModal.setAttribute("aria-hidden", "false");
}

function closeDetail(){
  detailModal.classList.add("hidden");
  detailModal.setAttribute("aria-hidden", "true");
  activeLeadId = null;
}

async function saveDetail(){
  if(!activeLeadId) return;

  saveDetailBtn.disabled = true;
  detailError.textContent = "";

  try{
    const response = await fetch(`${API}/admin/leads/${encodeURIComponent(activeLeadId)}/details`, {
      method:"PATCH",
      headers:authHeaders(),
      body:JSON.stringify({
        professional_assigned: detailProfessional.value.trim(),
        documents_status: detailDocuments.value,
        priority: detailPriority.value
      })
    });

    const data = await response.json();

    if(response.status === 401 || response.status === 403){
      sessionStorage.removeItem("daurel_admin_key");
      closeDetail();
      showLogin("Sesión vencida.");
      return;
    }

    if(!response.ok || !data.success){
      throw new Error(data.message || "No fue posible guardar los cambios.");
    }

    await loadLeads();
    openDetail(activeLeadId);
  }catch(error){
    detailError.textContent = error.message;
  }finally{
    saveDetailBtn.disabled = false;
  }
}

async function changeStatus(requestId, status){
  try{
    const response = await fetch(`${API}/admin/leads/${encodeURIComponent(requestId)}/status`, {
      method:"PATCH",
      headers:authHeaders(),
      body:JSON.stringify({status})
    });

    const data = await response.json();

    if(response.status === 401 || response.status === 403){
      sessionStorage.removeItem("daurel_admin_key");
      showLogin("Sesión vencida.");
      return;
    }

    if(!response.ok || !data.success){
      throw new Error(data.message || "No fue posible cambiar el estado.");
    }

    await loadLeads();
  }catch(error){
    panelMessage.textContent = error.message;
    panelMessage.classList.remove("hidden");
  }
}

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  const key = adminKeyInput.value.trim();
  if(!key) return;
  sessionStorage.setItem("daurel_admin_key", key);
  adminKeyInput.value = "";
  await loadLeads();
});

refreshBtn.addEventListener("click", loadLeads);

logoutBtn.addEventListener("click", () => {
  sessionStorage.removeItem("daurel_admin_key");
  closeDetail();
  showLogin();
});

statusFilter.addEventListener("change", render);
searchInput.addEventListener("input", render);
saveDetailBtn.addEventListener("click", saveDetail);

document.querySelectorAll("[data-close-detail]").forEach(element => {
  element.addEventListener("click", closeDetail);
});

document.addEventListener("keydown", event => {
  if(event.key === "Escape" && !detailModal.classList.contains("hidden")){
    closeDetail();
  }
});

leadsBody.addEventListener("click", event => {
  const detailButton = event.target.closest("[data-detail-id]");
  if(detailButton){
    openDetail(detailButton.dataset.detailId);
    return;
  }

  const statusButton = event.target.closest("[data-status][data-id]");
  if(statusButton){
    changeStatus(statusButton.dataset.id, statusButton.dataset.status);
  }
});

function getPriorityColor(lead){
  const priority = String(lead.priority || "").toLowerCase();
  const urgency = String(lead.urgency || "").toLowerCase();

  if(
    priority === "high" ||
    priority === "urgent" ||
    priority === "alta" ||
    urgency === "48h" ||
    urgency === "urgent"
  ){
    return "red";
  }

  if(
    priority === "medium" ||
    priority === "media" ||
    urgency === "soon"
  ){
    return "yellow";
  }

  return "green";
}

function formatDate(value){
  if(!value) return "—";
  const raw = String(value);
  const parsed = raw.includes("T") ? new Date(raw) : new Date(raw.replace(" ","T") + "Z");
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleString("es-MX");
}

function escapeHtml(value){
  return String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]));
}

function escapeAttr(value){ return escapeHtml(value); }

if(getKey()) loadLeads(); else showLogin();