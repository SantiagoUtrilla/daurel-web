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
const panelMessage = document.getElementById("panelMessage");
const lastUpdated = document.getElementById("lastUpdated");
let leads = [];

const labels = {
  new: "Nueva",
  contacted: "Contactada",
  in_attention: "En atención",
  closed: "Cerrada"
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
    if(!response.ok || !data.success) throw new Error(data.message || "No fue posible cargar las solicitudes.");
    leads = Array.isArray(data.leads) ? data.leads : [];
    showDashboard();
    render();
    lastUpdated.textContent = "Actualizado: " + new Date().toLocaleString("es-MX");
  }catch(error){
    leadsBody.innerHTML = '<tr><td colspan="9" class="empty">No fue posible cargar las solicitudes.</td></tr>';
    panelMessage.textContent = error.message;
    panelMessage.classList.remove("hidden");
  }
}

function render(){
  const filter = statusFilter.value;
  const visible = filter ? leads.filter(l => l.status === filter) : leads;
  document.getElementById("statNew").textContent = leads.filter(l=>l.status==="new").length;
  document.getElementById("statContacted").textContent = leads.filter(l=>l.status==="contacted").length;
  document.getElementById("statAttention").textContent = leads.filter(l=>l.status==="in_attention").length;
  document.getElementById("statClosed").textContent = leads.filter(l=>l.status==="closed").length;

  if(!visible.length){
    leadsBody.innerHTML = '<tr><td colspan="9" class="empty">No hay solicitudes para mostrar.</td></tr>';
    return;
  }

  leadsBody.innerHTML = visible.map(lead => {
    const wa = lead.whatsapp_e164 ? `https://wa.me/${encodeURIComponent(lead.whatsapp_e164)}` : "#";
    const date = lead.created_at ? new Date(lead.created_at.replace(" ","T")+"Z").toLocaleString("es-MX") : "—";
    return `<tr>
      <td><strong>${escapeHtml(lead.request_id)}</strong></td>
      <td>${escapeHtml(lead.name || "—")}</td>
      <td><a class="wa" href="${wa}" target="_blank" rel="noopener">+${escapeHtml(lead.whatsapp_e164 || "")}</a></td>
      <td>${escapeHtml(lead.category_internal || "general")}</td>
      <td>${escapeHtml(lead.urgency || "unknown")}</td>
      <td>${escapeHtml(lead.location || "—")}</td>
      <td><span class="status">${escapeHtml(labels[lead.status] || lead.status || "—")}</span></td>
      <td>${escapeHtml(date)}</td>
      <td><div class="actions">
        <button class="action-btn" data-status="contacted" data-id="${escapeAttr(lead.request_id)}">Contactada</button>
        <button class="action-btn primary" data-status="in_attention" data-id="${escapeAttr(lead.request_id)}">En atención</button>
        <button class="action-btn" data-status="closed" data-id="${escapeAttr(lead.request_id)}">Cerrada</button>
      </div></td>
    </tr>`;
  }).join("");
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
    if(!response.ok || !data.success) throw new Error(data.message || "No fue posible cambiar el estado.");
    await loadLeads();
  }catch(error){
    panelMessage.textContent = error.message;
    panelMessage.classList.remove("hidden");
  }
}

loginForm.addEventListener("submit", async (event)=>{
  event.preventDefault();
  const key = adminKeyInput.value.trim();
  if(!key) return;
  sessionStorage.setItem("daurel_admin_key", key);
  adminKeyInput.value = "";
  await loadLeads();
});

refreshBtn.addEventListener("click", loadLeads);
logoutBtn.addEventListener("click", ()=>{
  sessionStorage.removeItem("daurel_admin_key");
  showLogin();
});
statusFilter.addEventListener("change", render);
leadsBody.addEventListener("click", (event)=>{
  const button = event.target.closest("[data-status][data-id]");
  if(button) changeStatus(button.dataset.id, button.dataset.status);
});

function escapeHtml(value){
  return String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]));
}
function escapeAttr(value){ return escapeHtml(value); }

if(getKey()) loadLeads(); else showLogin();