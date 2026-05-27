class LeadApp {
    constructor() {
        this.view = 'dashboard';
        this.leads = [];
        this.charts = {};
        this.selectedLeadId = null;
        this.uploadedData = [];
        this.scrapedData = [];

        this.init();
    }

    init() {
        console.log('Initializing App...');
        this.loadView('dashboard');
        this.bindEvents();
        this.updateDate();
    }

    updateDate() {
        const el = document.getElementById('current-date');
        if (!el) return;
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        el.innerText = new Date().toLocaleDateString('en-US', options);
    }

    bindEvents() {
        // Navigation
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        const openBtn = document.getElementById('open-sidebar');
        const closeBtn = document.getElementById('close-sidebar');

        const toggleSidebar = (show) => {
            if (!sidebar || !overlay) return;
            if (show) {
                sidebar.classList.remove('-translate-x-full');
                overlay.classList.remove('hidden');
                document.body.style.overflow = 'hidden';
            } else {
                sidebar.classList.add('-translate-x-full');
                overlay.classList.add('hidden');
                document.body.style.overflow = '';
            }
        };

        if (openBtn) openBtn.onclick = () => toggleSidebar(true);
        if (closeBtn) closeBtn.onclick = () => toggleSidebar(false);
        if (overlay) overlay.onclick = () => toggleSidebar(false);

        document.querySelectorAll('.nav-item').forEach(link => {
            link.onclick = (e) => {
                e.preventDefault();
                const view = e.currentTarget.dataset.view;
                this.loadView(view);
                if (window.innerWidth < 1024) toggleSidebar(false);
            };
        });

        // Search & Filter
        const searchInput = document.getElementById('search-input');
        if (searchInput) searchInput.oninput = () => this.renderLeadsTable();

        const filterStatus = document.getElementById('filter-status');
        if (filterStatus) filterStatus.onchange = () => this.renderLeadsTable();

        const filterOccupation = document.getElementById('filter-occupation');
        if (filterOccupation) filterOccupation.oninput = () => this.renderLeadsTable();

        const filterLocation = document.getElementById('filter-location');
        if (filterLocation) filterLocation.oninput = () => this.renderLeadsTable();

        // Lead Form
        const addLeadForm = document.getElementById('add-lead-form');
        if (addLeadForm) {
            addLeadForm.onsubmit = async (e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                const body = Object.fromEntries(formData.entries());
                await this.api('/leads', { method: 'POST', body: JSON.stringify(body) });
                this.closeAddLeadModal();
                this.loadLeads();
                e.target.reset();
            };
        }

        // Template Form
        const addTemplateForm = document.getElementById('add-template-form');
        if (addTemplateForm) {
            addTemplateForm.onsubmit = async (e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                await this.api('/templates', { method: 'POST', body: JSON.stringify(Object.fromEntries(formData.entries())) });
                this.closeAddTemplateModal();
                this.loadTemplates();
                e.target.reset();
            };
        }

        // File Import
        const fileInput = document.getElementById('file-input');
        if (fileInput) fileInput.onchange = (e) => this.handleFileUpload(e);

        // Select All Table
        const selectAll = document.getElementById('select-all');
        if (selectAll) {
            selectAll.onchange = (e) => {
                document.querySelectorAll('.lead-checkbox').forEach(cb => {
                    cb.checked = e.target.checked;
                });
            };
        }
    }

    async api(endpoint, options = {}) {
        const url = `/api${endpoint}`;
        const defaultHeaders = {
            'Content-Type': 'application/json'
        };

        const mergedOptions = { ...options };
        if (!mergedOptions.headers) {
            mergedOptions.headers = defaultHeaders;
        } else {
            mergedOptions.headers = { ...defaultHeaders, ...mergedOptions.headers };
        }

        if (options.body instanceof FormData) {
            delete mergedOptions.headers['Content-Type'];
        }

        try {
            const res = await fetch(url, mergedOptions);

            const contentType = res.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await res.json();
            } else {
                const text = await res.text();
                console.error('Non-JSON Response:', text);
                return {
                    error: true,
                    message: `Server returned ${res.status} (${res.statusText}). Expected JSON but got ${contentType || 'unknown'}.`
                };
            }
        } catch (err) {
            console.error('API Error:', err);
            return { error: true, message: `Network Error: ${err.message}` };
        }
    }

    async loadView(view) {
        this.view = view;
        document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
        document.querySelectorAll('.nav-item').forEach(v => v.classList.remove('active'));

        const activeView = document.getElementById(`view-${view}`);
        const activeNav = document.querySelector(`.nav-item[data-view="${view}"]`);

        if (activeView) activeView.classList.remove('hidden');
        if (activeNav) activeNav.classList.add('active');

        // Update Title
        const titles = {
            'dashboard': ['Dashboard', 'Performance overview and KPIs'],
            'leads': ['Lead Manager', 'Direct actions on your pipeline'],
            'scraper': ['Discovery Tool', 'Real-time prospective data'],
            'upload': ['Import Center', 'Bulk spreadsheet processing'],
            'automation': ['Automation', 'Intelligent messaging triggers'],
            'ai-training': ['AI Training Center', 'Configure Gemini behavior for data import']
        };

        if (titles[view]) {
            document.getElementById('view-title').innerText = titles[view][0];
            document.getElementById('view-subtitle').innerText = titles[view][1];
        }

        if (view === 'dashboard') this.loadDashboard();
        if (view === 'leads') this.loadLeads();
        if (view === 'automation') this.loadTemplates();
        if (view === 'ai-training') this.loadAIConfig();

        // Animation for view transition
        if (activeView) {
            anime({
                targets: activeView,
                translateY: [10, 0],
                opacity: [0, 1],
                duration: 600,
                easing: 'easeOutSine'
            });
        }
    }

    async loadDashboard() {
        const stats = await this.api('/stats');
        if (!stats || stats.error) return;

        this.animateValue('stat-total', stats.total);

        const contacted = stats.statusCounts.find(s => s.status === 'Contacted')?.count || 0;
        const closed = stats.statusCounts.find(s => s.status === 'Closed')?.count || 0;

        this.animateValue('stat-contacted', contacted);
        this.animateValue('stat-closed', closed);

        this.renderCharts(stats.statusCounts, stats.sourceCounts);
    }

    animateValue(id, target) {
        const obj = { val: 0 };
        anime({
            targets: obj,
            val: target,
            round: 1,
            easing: 'easeOutExpo',
            duration: 1500,
            update: () => {
                const el = document.getElementById(id);
                if (el) el.innerText = obj.val;
            }
        });
    }

    renderCharts(statusData, sourceData) {
        if (this.charts.status) this.charts.status.destroy();
        if (this.charts.source) this.charts.source.destroy();

        const statusCtxE = document.getElementById('statusChart');
        if (!statusCtxE) return;

        const statusCtx = statusCtxE.getContext('2d');
        this.charts.status = new Chart(statusCtx, {
            type: 'bar',
            data: {
                labels: statusData.map(d => d.status),
                datasets: [{
                    data: statusData.map(d => d.count),
                    backgroundColor: '#6366f1',
                    borderRadius: 12,
                    barThickness: 30
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, grid: { color: '#f1f5f9' }, border: { display: false } },
                    x: { grid: { display: false } }
                }
            }
        });

        const sourceCtxE = document.getElementById('sourceChart');
        if (!sourceCtxE) return;

        const sourceCtx = sourceCtxE.getContext('2d');
        this.charts.source = new Chart(sourceCtx, {
            type: 'doughnut',
            data: {
                labels: sourceData.map(d => d.source || 'Organic'),
                datasets: [{
                    data: sourceData.map(d => d.count),
                    backgroundColor: ['#6366f1', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6'],
                    borderWidth: 0,
                    hoverOffset: 20
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '75%',
                plugins: { legend: { position: 'bottom', labels: { padding: 20, usePointStyle: true, font: { weight: '600', family: 'Outfit' } } } }
            }
        });
    }

    async loadLeads() {
        const data = await this.api('/leads');
        if (data && !data.error) {
            this.leads = data;
            this.renderLeadsTable();
        }
    }

    renderLeadsTable() {
        const query = document.getElementById('search-input')?.value.toLowerCase() || '';
        const statusFilter = document.getElementById('filter-status')?.value || '';
        const occupationFilter = document.getElementById('filter-occupation')?.value.toLowerCase() || '';
        const locationFilter = document.getElementById('filter-location')?.value.toLowerCase() || '';

        const filtered = this.leads.filter(l => {
            const matchesSearch = l.name.toLowerCase().includes(query) ||
                (l.email && l.email.toLowerCase().includes(query)) ||
                (l.phone && l.phone.includes(query));
            const matchesStatus = !statusFilter || l.status === statusFilter;
            const matchesOccupation = !occupationFilter || (l.occupation && l.occupation.toLowerCase().includes(occupationFilter));
            const matchesLocation = !locationFilter || 
                (l.city && l.city.toLowerCase().includes(locationFilter)) ||
                (l.state && l.state.toLowerCase().includes(locationFilter)) ||
                (l.address && l.address.toLowerCase().includes(locationFilter));

            return matchesSearch && matchesStatus && matchesOccupation && matchesLocation;
        });

        const tbody = document.getElementById('leads-tbody-premium');
        if (!tbody) return;

        tbody.innerHTML = filtered.map((l, index) => `
            <tr class="group hover:bg-slate-50/50 transition-all border-b border-transparent hover:border-slate-100">
                <td class="p-6">
                    <input type="checkbox" class="lead-checkbox w-5 h-5 rounded-lg border-slate-200 text-indigo-600 cursor-pointer" data-id="${l._id}">
                </td>
                <td class="p-6 text-sm font-bold text-slate-500">
                    ${index + 1}
                </td>
                <td class="p-6 cursor-pointer" onclick="window.app.viewLead('${l._id}')">
                    <div class="flex items-center gap-4">
                        <div class="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center font-black text-sm">
                            ${l.name[0].toUpperCase()}
                        </div>
                        <div>
                            <p class="font-bold text-slate-800">${l.name}</p>
                            <p class="text-[10px] text-slate-400 font-black uppercase tracking-widest">${new Date(l.created_at).toLocaleDateString()}</p>
                        </div>
                    </div>
                </td>
                <td class="p-6">
                    <p class="text-sm font-bold text-slate-600 mb-1">${l.email || '—'}</p>
                    <p class="text-xs font-semibold text-slate-400">${l.phone || '—'}</p>
                </td>
                <td class="p-6">
                    <span class="text-[10px] font-black text-indigo-600 bg-indigo-50 px-3 py-1 rounded-lg uppercase tracking-wider">${l.occupation || '—'}</span>
                </td>
                <td class="p-6 text-center">
                    <p class="text-sm font-bold text-slate-600">${l.city || '—'}, ${l.state || '—'}</p>
                </td>
                <td class="p-6 text-right">
                    <button onclick="window.app.deleteLead('${l._id}')" class="w-10 h-10 rounded-xl bg-slate-50 text-rose-400 hover:bg-rose-50 hover:text-rose-600 transition-all">
                        <i class="fa-solid fa-trash-can text-sm"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    }

    getStatusConfig(status) {
        const configs = {
            'New': { bg: '#eef2ff', text: '#6366f1' },
            'Contacted': { bg: '#fffbeb', text: '#f59e0b' },
            'Follow-up': { bg: '#fef2f2', text: '#f43f5e' },
            'Closed': { bg: '#ecfdf5', text: '#10b981' },
            'Lost': { bg: '#f8fafc', text: '#64748b' }
        };
        return configs[status] || configs['New'];
    }

    async viewLead(id) {
        this.selectedLeadId = id;
        const res = await this.api(`/leads/${id}/details`);
        if (!res || res.error) return;

        const { lead, notes } = res;
        document.getElementById('modal-lead-name').innerText = lead.name;
        document.getElementById('modal-lead-source').innerText = `Source: ${lead.source || 'Unknown'}`;
        document.getElementById('modal-initials').innerText = lead.name[0].toUpperCase();
        document.getElementById('modal-email').innerText = lead.email || '—';
        document.getElementById('modal-phone').innerText = lead.phone || '—';
        document.getElementById('modal-location').innerText = `${lead.city || '—'}, ${lead.state || '—'}`;
        document.getElementById('modal-status-select').value = lead.status;

        this.renderNotes(notes);
        this.showModal('lead-modal');
    }

    renderNotes(notes) {
        const list = document.getElementById('notes-list');
        if (!list) return;
        list.innerHTML = notes.slice().reverse().map(n => `
            <div class="p-6 bg-slate-50 rounded-2xl border border-white">
                <p class="text-sm font-semibold text-slate-700 leading-relaxed">${n.content}</p>
                <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-4">
                    <i class="fa-solid fa-clock mr-1"></i> ${new Date(n.created_at).toLocaleString()}
                </p>
            </div>
        `).join('');
    }

    async addNote() {
        const content = document.getElementById('note-input').value;
        if (!content) return;

        await this.api(`/leads/${this.selectedLeadId}/notes`, {
            method: 'POST',
            body: JSON.stringify({ content })
        });

        document.getElementById('note-input').value = '';
        this.viewLead(this.selectedLeadId);
    }

    async updateLeadStatus() {
        const status = document.getElementById('modal-status-select').value;
        await this.api(`/leads/${this.selectedLeadId}`, {
            method: 'PUT',
            body: JSON.stringify({ status })
        });

        this.loadLeads();
        this.closeLeadModal();
    }

    // Modal Helpers
    showModal(id) {
        const modal = document.getElementById(id);
        if (modal) {
            modal.classList.remove('hidden');
            anime({
                targets: modal.querySelector('.slide-up'),
                translateY: [20, 0],
                opacity: [0, 1],
                duration: 400,
                easing: 'easeOutQuart'
            });
        }
    }

    closeModal(id) {
        const modal = document.getElementById(id);
        if (modal) {
            anime({
                targets: modal.querySelector('.slide-up'),
                translateY: [0, 20],
                opacity: [1, 0],
                duration: 300,
                easing: 'easeInQuart',
                complete: () => modal.classList.add('hidden')
            });
        }
    }

    showAddLeadModal() { this.showModal('add-lead-modal'); }
    closeAddLeadModal() { this.closeModal('add-lead-modal'); }

    showAddTemplateModal() { this.showModal('add-template-modal'); }
    closeAddTemplateModal() { this.closeModal('add-template-modal'); }

    closeLeadModal() { this.closeModal('lead-modal'); }

    async deleteLead(id) {
        if (!confirm('DANGER: This will permanently delete this lead record. Continue?')) return;
        await this.api(`/leads/${id}`, { method: 'DELETE' });
        this.loadLeads();
    }

    async bulkDelete() {
        const selected = Array.from(document.querySelectorAll('.lead-checkbox:checked')).map(cb => cb.dataset.id);
        if (!selected.length) return alert('Select leads to perform deletion');
        if (!confirm(`Delete ${selected.length} selected leads?`)) return;

        await this.api('/leads/bulk', {
            method: 'DELETE',
            body: JSON.stringify({ ids: selected })
        });
        this.loadLeads();
    }

    getFilteredLeads() {
        const query = document.getElementById('search-input')?.value.toLowerCase() || '';
        const statusFilter = document.getElementById('filter-status')?.value || '';
        const occupationFilter = document.getElementById('filter-occupation')?.value.toLowerCase() || '';
        const locationFilter = document.getElementById('filter-location')?.value.toLowerCase() || '';

        let filtered = this.leads.filter(l => {
            const matchesSearch = l.name.toLowerCase().includes(query) ||
                (l.email && l.email.toLowerCase().includes(query)) ||
                (l.phone && l.phone.includes(query));
            const matchesStatus = !statusFilter || l.status === statusFilter;
            const matchesOccupation = !occupationFilter || (l.occupation && l.occupation.toLowerCase().includes(occupationFilter));
            const matchesLocation = !locationFilter || 
                (l.city && l.city.toLowerCase().includes(locationFilter)) ||
                (l.state && l.state.toLowerCase().includes(locationFilter)) ||
                (l.address && l.address.toLowerCase().includes(locationFilter));

            return matchesSearch && matchesStatus && matchesOccupation && matchesLocation;
        });

        // Apply Range
        const from = parseInt(document.getElementById('export-from')?.value) || 1;
        const to = parseInt(document.getElementById('export-to')?.value) || filtered.length;

        return filtered.slice(from - 1, to);
    }

        // Helper to prompt user for fields to export
    getExportFields(defaultFields) {
        const available = ['name', 'email', 'phone', 'occupation', 'city', 'state', 'source', 'status', 'created_at'];
        const input = window.prompt('Enter fields to export, separated by commas (e.g., name,phone,city). Available: ' + available.join(', '), defaultFields?.join(', ') || '' );
        if (!input) return [];
        const selected = input.split(',').map(f => f.trim().toLowerCase()).filter(f => available.includes(f));
        if (selected.length === 0) {
            alert('No valid fields selected. Export cancelled.');
            return [];
        }
        return selected;
    }

    exportCSV() {
        const leadsToExport = this.getFilteredLeads();
        if (!leadsToExport.length) return alert('No leads to export in this range/filter');

        const fields = this.getExportFields(['name', 'phone']);
        if (fields.length === 0) return; // user cancelled

        const headers = fields.map(f => {
            if (f === 'created_at') return 'Created At';
            return f.charAt(0).toUpperCase() + f.slice(1);
        });
        const rows = leadsToExport.map(l => {
            return fields.map(f => {
                if (f === 'created_at') return new Date(l.created_at).toLocaleString();
                return l[f] !== undefined ? l[f] : '';
            }).join(',');
        });
        const csvContent = headers.join(',') + "\n" + rows.join('\n');
        this.downloadFile(csvContent, 'leads.csv', 'text/csv');
    }

    exportExcel() {
        const leadsToExport = this.getFilteredLeads();
        if (!leadsToExport.length) return alert('No leads to export in this range/filter');
        if (typeof XLSX === 'undefined') return alert('XLSX library not loaded');

        const fields = this.getExportFields(['name', 'phone']);
        if (fields.length === 0) return; // user cancelled

        const data = leadsToExport.map(l => {
            const obj = {};
            fields.forEach(f => {
                if (f === 'created_at') {
                    obj['Created At'] = new Date(l.created_at).toLocaleString();
                } else {
                    const header = f.charAt(0).toUpperCase() + f.slice(1);
                    obj[header] = l[f] !== undefined ? l[f] : '';
                }
            });
            return obj;
        });
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Leads");
        XLSX.writeFile(wb, "Leads_Export.xlsx");
    }


    downloadFile(content, fileName, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);
    }

    async handleFileUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        const res = await this.api('/upload', {
            method: 'POST',
            body: formData
        });

        if (!res || res.error) return alert('Upload failed');

        this.uploadedData = res;

        // Check for AI Clean
        const aiToggle = document.getElementById('ai-clean-toggle');
        if (aiToggle && aiToggle.checked) {
            const btn = e.target.previousElementSibling;
            const originalText = btn.innerText;
            btn.disabled = true;

            const batchSize = 15; // Smaller batch for stability
            const allCleaned = [];
            const total = this.uploadedData.length;

            try {
                for (let i = 0; i < total; i += batchSize) {
                    const batch = this.uploadedData.slice(i, i + batchSize);
                    btn.innerHTML = `<i class="fa-solid fa-robot animate-pulse mr-2"></i> Cleaned ${i}/${total}...`;

                    const cleaned = await this.api('/leads/ai-clean', {
                        method: 'POST',
                        body: JSON.stringify({ leads: batch })
                    });

                    if (cleaned && !cleaned.error) {
                        allCleaned.push(...cleaned);
                    } else {
                        allCleaned.push(...batch);
                    }
                }
                this.uploadedData = allCleaned;
            } catch (err) {
                console.warn('AI Clean failed', err);
            }

            btn.disabled = false;
            btn.innerText = originalText;
        }

        this.renderMappingUI();
        this.renderPreview();
    }

    renderMappingUI() {
        const container = document.getElementById('mapping-container');
        if (!container || !this.uploadedData.length) return;

        const headers = Object.keys(this.uploadedData[0]);
        const fields = [
            { id: 'name', label: 'Name *', search: ['name', 'full name', 'customer', 'lead', 'person'] },
            { id: 'phone', label: 'Phone', search: ['phone', 'number', 'mobile', 'contact', 'tel'] },
            { id: 'email', label: 'Email', search: ['email', 'mail', 'e-mail'] },
            { id: 'occupation', label: 'Occupation', search: ['occupation', 'profession', 'job', 'work', 'architect', 'builder', 'profession'] },
            { id: 'address', label: 'Address', search: ['address', 'street', 'location', 'addr'] },
            { id: 'city', label: 'City', search: ['city', 'town'] },
            { id: 'state', label: 'State', search: ['state', 'province', 'region'] },
            { id: 'source', label: 'Source', search: ['source', 'origin', 'medium', 'website'] },
            { id: 'location', label: 'Location URL', search: ['location', 'map', 'directions', 'url', 'link'] }
        ];

        container.innerHTML = fields.map(field => {
            const matchedHeader = headers.find(h =>
                field.search.some(s => h.toLowerCase().includes(s))
            ) || '';

            return `
                <div class="bg-white p-6 rounded-2xl border border-indigo-50 shadow-sm transition-all hover:shadow-md">
                    <label class="block text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-3 ml-1">${field.label}</label>
                    <select class="mapping-select w-full p-4 rounded-xl bg-slate-50 border-none font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500/20" data-field="${field.id}">
                        <option value="">-- Skip Field --</option>
                        ${headers.map(h => `<option value="${h}" ${h === matchedHeader ? 'selected' : ''}>${h}</option>`).join('')}
                    </select>
                </div>
            `;
        }).join('');

        document.getElementById('mapping-section').classList.remove('hidden');
        document.getElementById('import-actions').classList.remove('hidden');
    }

    renderPreview() {
        const thead = document.getElementById('preview-thead');
        const tbody = document.getElementById('preview-tbody');
        if (!thead || !tbody || !this.uploadedData.length) return;

        const cols = Object.keys(this.uploadedData[0]);
        thead.innerHTML = `<tr>${cols.map(c => `<th class="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">${c}</th>`).join('')}</tr>`;
        tbody.innerHTML = this.uploadedData.slice(0, 5).map(row => `
            <tr class="${row.isJunk ? 'bg-rose-50/50' : ''}">
                ${cols.map(c => `
                    <td class="p-6 text-sm font-semibold ${row.isJunk ? 'text-rose-600' : 'text-slate-600'}">
                        ${row[c] || '—'}
                        ${row.isJunk && c === cols[0] ? '<span class="ml-2 px-2 py-0.5 bg-rose-100 text-[8px] rounded-md">JUNK</span>' : ''}
                    </td>
                `).join('')}
            </tr>
        `).join('');

        document.getElementById('preview-section').classList.remove('hidden');
    }

    resetImport() {
        this.uploadedData = [];
        document.getElementById('mapping-section').classList.add('hidden');
        document.getElementById('preview-section').classList.add('hidden');
        document.getElementById('import-actions').classList.add('hidden');
        const fileInput = document.getElementById('file-input');
        if (fileInput) fileInput.value = '';

        const aiToggle = document.getElementById('ai-clean-toggle');
        if (aiToggle) aiToggle.checked = false;

        const dedupToggle = document.getElementById('dedup-toggle');
        if (dedupToggle) dedupToggle.checked = true;
    }

    async saveUploadedLeads() {
        const btn = event.target;
        const mapping = {};
        document.querySelectorAll('.mapping-select').forEach(sel => {
            if (sel.value) mapping[sel.dataset.field] = sel.value;
        });

        if (!mapping.name) {
            return alert('Critical field "Name" must be mapped to proceed.');
        }

        btn.disabled = true;
        const originalText = btn.innerText;
        btn.innerText = 'Initializing Import...';

        let dataToSave = [];

        // Check for AI Deep Clean Toggle
        const aiToggle = document.getElementById('ai-clean-toggle');
        if (aiToggle && aiToggle.checked) {
            const batchSize = 15;
            const total = this.uploadedData.length;

            try {
                for (let i = 0; i < total; i += batchSize) {
                    const batch = this.uploadedData.slice(i, i + batchSize);
                    btn.innerHTML = `<i class="fa-solid fa-robot animate-pulse mr-2"></i> AI Cleaning ${i}/${total}...`;

                    const cleaned = await this.api('/leads/ai-clean', {
                        method: 'POST',
                        body: JSON.stringify({ leads: batch, mapping })
                    });

                    if (cleaned && !cleaned.error) {
                        dataToSave.push(...cleaned);
                    } else {
                        // Fallback to manual mapping if AI fails for a batch
                        const fallbackBatch = batch.map(row => {
                            const lead = { status: 'New', source: 'Bulk Import' };
                            Object.keys(mapping).forEach(field => {
                                const val = row[mapping[field]];
                                if (val !== undefined && val !== null) {
                                    const strVal = String(val).trim();
                                    lead[field] = strVal;

                                    // Basic Junk Detection for Fallback
                                    const junkWords = ['no review', 'unit no', 'opposite', 'piru-2', 'test entry'];
                                    if (field === 'name' && junkWords.some(j => strVal.toLowerCase().includes(j))) {
                                        lead.isJunk = true;
                                    }
                                }
                            });
                            return lead;
                        });
                        dataToSave.push(...fallbackBatch);
                    }
                }
            } catch (err) {
                console.warn('AI Deep Clean failed, falling back to manual mapping', err);
            }
        }

        // If AI wasn't used or failed entirely, perform standard manual mapping
        if (dataToSave.length === 0) {
            dataToSave = this.uploadedData.map(row => {
                const lead = { status: 'New', source: 'Bulk Import' };
                Object.keys(mapping).forEach(field => {
                    const value = row[mapping[field]];
                    if (value !== undefined && value !== null) {
                        lead[field] = String(value).trim();
                    }
                });
                return lead;
            });
        }

        btn.innerText = 'Saving to CRM...';

        // Filter out rows where name is empty or marked as junk
        const validLeads = dataToSave.filter(l => {
            const hasName = l.name && l.name.trim().length > 1;
            const isJunk = l.isJunk === true || String(l.isJunk).toLowerCase() === 'true';
            return hasName && !isJunk;
        });

        const dedupToggle = document.getElementById('dedup-toggle');
        const skipDuplicates = dedupToggle ? dedupToggle.checked : true;

        const res = await this.api('/leads/bulk-insert', {
            method: 'POST',
            body: JSON.stringify({ leads: validLeads, skipDuplicates })
        });

        if (res && !res.error) {
            let successText = 'Import Successful!';
            if (res.skippedCount > 0) {
                alert(`Import successful!\n\nImported: ${res.insertedCount} leads\nSkipped: ${res.skippedCount} duplicate phone numbers.`);
                successText = `Imported ${res.insertedCount} (${res.skippedCount} skipped)`;
            }
            btn.innerText = successText;
            btn.classList.replace('bg-indigo-600', 'bg-emerald-500');
            setTimeout(() => {
                this.loadView('leads');
                this.resetImport();
                btn.disabled = false;
                btn.innerText = originalText;
                btn.classList.replace('bg-emerald-500', 'bg-indigo-600');
            }, 2000);
        } else {
            alert('Import failed: ' + (res?.message || 'Unknown error'));
            btn.disabled = false;
            btn.innerText = originalText;
        }
    }



    // Automation
    async loadTemplates() {
        const templates = await this.api('/templates');
        if (!templates || templates.error) return;
        this.renderTemplatesTable(templates);
    }

    renderTemplatesTable(templates) {
        const view = document.getElementById('view-automation');
        if (!view) return;

        view.innerHTML = `
            <div class="flex items-center justify-between mb-8">
                <h3 class="text-2xl font-black text-slate-800">Email Templates</h3>
                <button onclick="window.app.showAddTemplateModal()" class="px-8 py-4 bg-indigo-600 text-white rounded-2xl font-black shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all">New Template</button>
            </div>
            <div class="card-glass !p-0 overflow-hidden">
                <table class="w-full text-left">
                    <thead class="bg-slate-50">
                        <tr>
                            <th class="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Template Name</th>
                            <th class="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Trigger (Status)</th>
                            <th class="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-50">
                        ${templates.map(t => `
                            <tr>
                                <td class="p-6 font-bold text-slate-800">${t.name}</td>
                                <td class="p-6">
                                    <span class="px-3 py-1 bg-amber-50 text-amber-600 rounded-lg text-[10px] font-black uppercase tracking-wider">${t.trigger_status}</span>
                                </td>
                                <td class="p-6 text-right">
                                    <button onclick="window.app.deleteTemplate('${t._id}')" class="w-10 h-10 rounded-xl bg-slate-50 text-rose-400 hover:bg-rose-50 hover:text-rose-600 transition-all">
                                        <i class="fa-solid fa-trash-can text-sm"></i>
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    async deleteTemplate(id) {
        if (!confirm('Delete this template? Automation for this status will cease.')) return;
        await this.api(`/templates/${id}`, { method: 'DELETE' });
        this.loadTemplates();
    }

    async startScraping() {
        const query = document.getElementById('scraper-query').value;
        if (!query) return;

        const btn = document.getElementById('scrape-btn');
        btn.disabled = true;
        btn.innerText = 'Searching Web...';

        const results = await this.api('/scrape', {
            method: 'POST',
            body: JSON.stringify({ query })
        });

        if (results && !results.error) {
            this.scrapedData = results;
            this.renderScraperResults();
        }
        btn.disabled = false;
        btn.innerText = 'Launch Search';
    }

    renderScraperResults() {
        const section = document.getElementById('scraper-results-section');
        const tbody = document.getElementById('scraper-tbody-premium');
        if (!section || !tbody) return;

        document.getElementById('scraper-count').innerText = this.scrapedData.length;

        tbody.innerHTML = this.scrapedData.map(l => `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="p-6 font-bold text-slate-800">${l.name}</td>
                <td class="p-6"><p class="text-sm font-bold text-indigo-600">${l.phone || '—'}</p></td>
                <td class="p-6">
                    <p class="text-sm font-bold text-slate-600">${(l.city && l.state) ? `${l.city}, ${l.state}` : (l.city || l.state || '—')}</p>
                    <p class="text-xs font-semibold text-slate-400 mt-0.5">${l.address || '—'}</p>
                </td>
            </tr>
        `).join('');

        section.classList.remove('hidden');
    }

    async importScrapedLeads() {
        if (!this.scrapedData.length) return;
        const res = await this.api('/leads/bulk-insert', {
            method: 'POST',
            body: JSON.stringify({ leads: this.scrapedData, skipDuplicates: true })
        });
        if (res && !res.error) {
            if (res.skippedCount > 0) {
                alert(`Import successful!\n\nImported: ${res.insertedCount} leads\nSkipped: ${res.skippedCount} duplicate phone numbers.`);
            } else {
                alert(`Successfully imported ${res.insertedCount} leads.`);
            }
        } else {
            alert('Import failed: ' + (res?.message || 'Unknown error'));
        }
        this.loadView('leads');
    }

    async loadAIConfig() {
        const config = await this.api('/ai-config');
        if (!config || config.error) return;

        const instructions = document.getElementById('ai-system-instructions');
        const rules = document.getElementById('ai-custom-rules');
        const examples = document.getElementById('ai-examples');

        if (instructions) instructions.value = config.systemInstructions || '';
        if (rules) rules.value = config.customRules || '';
        if (examples) examples.value = config.examples || '';
    }

    async saveAIConfig() {
        const instructions = document.getElementById('ai-system-instructions').value;
        const rules = document.getElementById('ai-custom-rules').value;
        const examples = document.getElementById('ai-examples').value;

        const btn = document.querySelector('button[onclick="window.app.saveAIConfig()"]');
        if (!btn) return;

        const originalText = btn.innerText;
        btn.disabled = true;
        btn.innerText = 'Syncing...';

        const res = await this.api('/ai-config', {
            method: 'POST',
            body: JSON.stringify({
                systemInstructions: instructions,
                customRules: rules,
                examples: examples
            })
        });

        if (res && !res.error) {
            btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Model Updated';
            setTimeout(() => {
                btn.disabled = false;
                btn.innerText = originalText;
            }, 2000);
        } else {
            alert('Failed to save AI configuration');
            btn.disabled = false;
            btn.innerText = originalText;
        }
    }
}

window.app = new LeadApp();
