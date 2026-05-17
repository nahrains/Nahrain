        // SECURITY: Never display raw passwords from DB — always run through this function.
        // SHA-256 hashes are 64 lowercase hex chars. If the value looks like a hash, block it.
        function _safePass(val) {
            if (!val) return null;
            if (/^[0-9a-f]{64}$/i.test(String(val))) return null;
            return String(val);
        }

        function switchAccTab(tabId) {
            document.querySelectorAll('.acc-tab-content').forEach(el => el.style.display = 'none');
            document.querySelectorAll('.acc-tab-btn').forEach(el => el.classList.remove('active'));
            const target = document.getElementById('acc-tab-' + tabId);
            if (target) target.style.display = 'block';
            const btn = document.getElementById('btn-acc-tab-' + tabId);
            if (btn) btn.classList.add('active');
            if (tabId === 'reports' && typeof updateAccCharts === 'function') {
                setTimeout(updateAccCharts, 300);
            }
            if (tabId === 'installments') {
                setTimeout(renderInstallmentTable, 100);
            }
            if (tabId === 'settings') {
                if (typeof loadInstallmentSchedule === 'function') setTimeout(loadInstallmentSchedule, 100);
            }
        }

        let accountantStudents = [];
        let accountantStaff = [];
        let accountantFinance = { revenues: [], expenses: [], defaults: {}, global: {}, expenseCategories: [], auditLogs: [] };
        window.currentAcademicYear = '2024 / 2025'; // Default, overwritten from Firebase

        async function loadAccountantData() {
            const userBranchId = currentUser ? currentUser.branchId : 'samawah';
            const branchInfo = (window.NAHRAIN_BRANCHES && window.NAHRAIN_BRANCHES[userBranchId]) ? window.NAHRAIN_BRANCHES[userBranchId] : null;
            const branchTitleElem = document.getElementById('acc-branch-title');
            if (branchTitleElem && branchInfo) branchTitleElem.innerText = `فرع: ${branchInfo.name}`;

            try {
                // جلب كل البيانات بالتوازي عبر REST API (أسرع بكثير من SDK)
                const [usersSnap, finSnap, defaultsSnap, catsSnap, globalDatesSnap,
                       instCountSnap, globalPercentsSnap, academicYearSnap, structSnap] = await Promise.all([
                    _restGet('users'),
                    _restGet('finance'),
                    _restGet('financialSettings/defaults'),
                    _restGet('financialSettings/expenseCategories'),
                    _restGet(`financialSettings/branches/${userBranchId}/globalDates`),
                    _restGet(`financialSettings/branches/${userBranchId}/installmentCount`),
                    _restGet(`financialSettings/branches/${userBranchId}/globalPercents`),
                    _restGet('financialSettings/academicYear'),
                    _restGet('settings/branches/' + userBranchId + '/structure')
                ]);

                accountantFinance.globalDates = globalDatesSnap.val() || {};
                accountantFinance.installmentCount = instCountSnap.val() || (userBranchId === 'primary' ? 3 : 5);
                accountantFinance.globalPercents = globalPercentsSnap.val() || {};
                
                window.schoolStructure = structSnap.val() || [];
                const users = usersSnap.val() || {};
                const finance = finSnap.val() || { revenues: {}, expenses: {} };
                accountantFinance.defaults = defaultsSnap.val() || {};
                accountantFinance.expenseCategories = catsSnap.val() || ['صيانة', 'قرطاسية', 'وقود', 'أخرى'];

                accountantStudents = Object.keys(users)
                    .filter(k => users[k].role === 'student' && users[k].branchId === userBranchId)
                    .map(k => ({ uid: k, ...users[k] }));

                accountantStaff = Object.keys(users)
                    .filter(k => (users[k].role === 'teacher' || users[k].role === 'admin' || users[k].role === 'accountant') && users[k].branchId === userBranchId)
                    .map(k => ({ uid: k, ...users[k] }));

                accountantFinance.revenues = Object.values(finance.revenues || {}).filter(r => r && r.branchId === userBranchId);
                accountantFinance.expenses = Object.values(finance.expenses || {}).filter(e => e && e.branchId === userBranchId);
                accountantFinance.auditLogs = Object.values(finance.auditLogs || {}).filter(l => l && l.branchId === userBranchId);

                renderAccountantUI();
                updateAccountantDashboardReports();
                loadAcademicYearSettings(academicYearSnap.val());
            } catch (e) { console.error(e); }
        }

        function getClassName(classId) {
            if (!classId) return '-';
            if (window.schoolStructure && window.schoolStructure.length) {
                for (let dept of window.schoolStructure) {
                    if (dept.stages) {
                        for (let st of dept.stages) {
                            if (st.sections) {
                                for (let sc of st.sections) {
                                    if (sc.id === classId) return `${dept.name} - ${st.name} - ${sc.name}`;
                                }
                            }
                        }
                    }
                }
            }
            // إذا لم يوجد في الهيكلية — حاول تفكيك الـ ID القديم (dept_stage_section)
            if (classId.includes('_') && !classId.startsWith('sect') && !classId.startsWith('sec_')) {
                const parts = classId.split('_');
                if (parts.length >= 2) return parts.join(' - ');
            }
            // ID جديد غير موجود في الهيكلية الحالية
            if (classId.startsWith('sect') || classId.startsWith('sec_')) return '(قسم محذوف أو محدث)';
            return classId;
        }

        // ============ ACADEMIC YEAR SETTINGS ============
        function loadAcademicYearSettings(data) {
            if (!data) return;
            window.currentAcademicYear = data.label || '2024 / 2025';

            const badge = document.getElementById('acc-current-year-badge');
            const labelInput = document.getElementById('acc-year-label');
            const startInput = document.getElementById('acc-year-start');
            const endInput = document.getElementById('acc-year-end');
            const invYear = document.getElementById('inv-report-year');

            if (badge) badge.innerText = window.currentAcademicYear;
            if (labelInput) labelInput.value = data.label || '';
            if (startInput) startInput.value = data.start || '';
            if (endInput) endInput.value = data.end || '';

            // Sync with inventory report year selector
            if (invYear && data.label) {
                const endYr = data.label.split('/').pop()?.trim();
                if (endYr) {
                    for (let opt of invYear.options) { if (opt.value === endYr) { opt.selected = true; break; } }
                    // Add if not found
                    if (!Array.from(invYear.options).some(o => o.value === endYr)) {
                        const opt = document.createElement('option');
                        opt.value = endYr;
                        opt.text = data.label;
                        opt.selected = true;
                        invYear.prepend(opt);
                    }
                }
            }
        }

        window.saveAcademicYear = async function() {
            const label = document.getElementById('acc-year-label')?.value.trim();
            const start = document.getElementById('acc-year-start')?.value;
            const end = document.getElementById('acc-year-end')?.value;

            if (!label) return showCustomAlert('تنبيه', 'يرجى إدخال اسم السنة الدراسية', 'warning');

            const data = { label, start: start || '', end: end || '', savedAt: Date.now(), savedBy: currentUser?.name || 'محاسب' };

            try {
                await _restSet('financialSettings/academicYear', data);
                window.currentAcademicYear = label;

                const badge = document.getElementById('acc-current-year-badge');
                if (badge) badge.innerText = label;

                // Show success msg
                const msg = document.getElementById('acc-year-saved-msg');
                if (msg) {
                    msg.style.display = 'flex';
                    setTimeout(() => { msg.style.display = 'none'; }, 3000);
                }

                // Add audit log
                if (window.addAccAuditLog) {
                    window.addAccAuditLog('تغيير السنة الدراسية', `تم تعيين السنة الدراسية إلى: ${label}`);
                }
            } catch (e) {
                alert('خطأ في الحفظ: ' + e.message);
            }
        };

        window.setCurrentAcademicYear = function() {
            const now = new Date();
            const month = now.getMonth() + 1; // 1-12
            // Academic year: Sep-Dec belongs to current/next, Jan-Jun belongs to prev/current
            const startYear = month >= 9 ? now.getFullYear() : now.getFullYear() - 1;
            const endYear = startYear + 1;
            const label = `${startYear} / ${endYear}`;
            const startDate = `${startYear}-09-01`;
            const endDate = `${endYear}-06-30`;

            const labelInput = document.getElementById('acc-year-label');
            const startInput = document.getElementById('acc-year-start');
            const endInput = document.getElementById('acc-year-end');

            if (labelInput) labelInput.value = label;
            if (startInput) startInput.value = startDate;
            if (endInput) endInput.value = endDate;

            showCustomAlert('تم التعيين', `تم تعيين السنة الدراسية تلقائياً: ${label}\nاضغط "حفظ" لتأكيد الحفظ.`, 'success');
        };
        // ============ END ACADEMIC YEAR SETTINGS ============

        // ============ INSTALLMENT SCHEDULE TABLE ============
        function _buildInstSectionMap() {
            const map = {};
            if (window.schoolStructure) {
                window.schoolStructure.forEach((dept, dIdx) => {
                    const stages = Array.isArray(dept.stages) ? dept.stages : Object.values(dept.stages || {});
                    stages.forEach((st, stIdx) => {
                        const sections = Array.isArray(st.sections) ? st.sections : Object.values(st.sections || {});
                        sections.forEach(sc => {
                            if (sc.id) map[sc.id] = { deptIdx: dIdx, stageIdx: stIdx };
                        });
                    });
                });
            }
            return map;
        }

        window.onInstDeptChange = function() {
            const deptEl  = document.getElementById('inst-filter-dept');
            const stageEl = document.getElementById('inst-filter-stage');
            const secEl   = document.getElementById('inst-filter-section');
            if (!deptEl || !stageEl || !secEl) return;
            const dIdx = deptEl.value;
            stageEl.innerHTML = '<option value="all">📖 جميع المراحل</option>';
            secEl.innerHTML   = '<option value="all">🏫 جميع الشعب</option>';
            if (dIdx !== 'all' && window.schoolStructure) {
                const dept = window.schoolStructure[dIdx];
                if (dept) {
                    const stages = Array.isArray(dept.stages) ? dept.stages : Object.values(dept.stages || {});
                    stages.forEach((st, stIdx) => {
                        stageEl.innerHTML += `<option value="${stIdx}">${st.name}</option>`;
                    });
                }
            }
            window.renderInstallmentTable();
        };

        window.onInstStageChange = function() {
            const deptEl  = document.getElementById('inst-filter-dept');
            const stageEl = document.getElementById('inst-filter-stage');
            const secEl   = document.getElementById('inst-filter-section');
            if (!deptEl || !stageEl || !secEl) return;
            const dIdx  = deptEl.value;
            const stIdx = stageEl.value;
            secEl.innerHTML = '<option value="all">🏫 جميع الشعب</option>';
            if (dIdx !== 'all' && stIdx !== 'all' && window.schoolStructure) {
                const dept   = window.schoolStructure[dIdx];
                const stages = Array.isArray(dept?.stages) ? dept.stages : Object.values(dept?.stages || {});
                const stage  = stages[stIdx];
                if (stage) {
                    const sections = Array.isArray(stage.sections) ? stage.sections : Object.values(stage.sections || {});
                    sections.forEach(sc => {
                        if (sc.id) secEl.innerHTML += `<option value="${sc.id}">${sc.name}</option>`;
                    });
                }
            }
            window.renderInstallmentTable();
        };

        window.setInstStatusFilter = function(val) {
            const sel = document.getElementById('inst-filter-status');
            if (sel) sel.value = val;
            document.querySelectorAll('#inst-status-chips .inst-chip').forEach(btn => {
                const isActive = btn.dataset.val === val;
                btn.classList.toggle('inst-chip-active', isActive);
            });
            window.renderInstallmentTable();
        };

        window.renderInstallmentTable = function() {
            const g = accountantFinance.globalDates || {};
            const p = accountantFinance.globalPercents || {};
            const instCount = accountantFinance.installmentCount || 5;
            const now = new Date();
            const filterNum     = document.getElementById('inst-filter-num')?.value    || 'all';
            const filterStatus  = document.getElementById('inst-filter-status')?.value  || 'all';
            const filterDept    = document.getElementById('inst-filter-dept')?.value    || 'all';
            const filterStage   = document.getElementById('inst-filter-stage')?.value   || 'all';
            const filterSection = document.getElementById('inst-filter-section')?.value || 'all';
            const _instSectionMap = _buildInstSectionMap();

            // Build installment columns array
            const instCols = [];
            for (let i = 1; i <= instCount; i++) {
                const dateStr = g['inst' + i] || '';
                const pct = Number(p['p' + i]) || (100 / instCount);
                instCols.push({ num: i, date: dateStr ? new Date(dateStr) : null, dateStr, pct });
            }

            // Build thead
            const thead = document.getElementById('acc-installments-thead');
            const _thBase = 'background:#1e3a8a; color:#fff; padding:9px 10px; font-size:0.75rem; font-weight:800; white-space:nowrap; border-left:1px solid #2d4fa0; position:sticky; top:0;';
            if (thead) {
                let thHtml = `<tr>
                    <th style="${_thBase} min-width:120px; text-align:right;">الطالب</th>
                    <th style="${_thBase} min-width:90px; text-align:right;">الشعبة</th>
                    <th style="${_thBase} min-width:100px; text-align:center;">المطلوب</th>`;
                instCols.forEach(col => {
                    const isPast = col.date && col.date < now;
                    const isSoon = col.date && !isPast && (col.date - now) < 7 * 24 * 3600 * 1000;
                    const pillBg  = isPast ? 'rgba(239,68,68,0.25)' : isSoon ? 'rgba(245,158,11,0.25)' : 'rgba(255,255,255,0.12)';
                    const pillTxt = isPast ? '#fca5a5' : isSoon ? '#fde68a' : '#bfdbfe';
                    thHtml += `<th style="${_thBase} min-width:110px; text-align:center;">
                        <div>القسط ${col.num} <span style="background:${pillBg}; color:${pillTxt}; border-radius:999px; padding:1px 5px; font-size:0.65rem;">${col.pct.toFixed(0)}%</span></div>
                        <div style="font-size:0.63rem; font-weight:600; opacity:0.8; margin-top:1px;">${col.dateStr ? new Date(col.dateStr).toLocaleDateString('ar-IQ') : 'بدون موعد'}</div>
                    </th>`;
                });
                thHtml += `<th style="${_thBase} min-width:110px; text-align:center; border-left:none;">الحالة</th></tr>`;
                thead.innerHTML = thHtml;
            }

            // Populate dept filter once
            const deptSel = document.getElementById('inst-filter-dept');
            if (deptSel && deptSel.options.length <= 1 && window.schoolStructure) {
                window.schoolStructure.forEach((dept, dIdx) => {
                    deptSel.innerHTML += `<option value="${dIdx}">${dept.name}</option>`;
                });
            }

            // Build rows
            let kpiOverdue = 0, kpiSoon = 0, kpiPaid = 0, kpiNotDue = 0;
            let rows = [];

            accountantStudents.forEach(s => {
                if (filterSection !== 'all') {
                    if (s.classId !== filterSection) return;
                } else if (filterDept !== 'all' || filterStage !== 'all') {
                    const info = _instSectionMap[s.classId];
                    if (!info) return;
                    if (filterDept  !== 'all' && String(info.deptIdx)  !== filterDept)  return;
                    if (filterStage !== 'all' && String(info.stageIdx) !== filterStage) return;
                }

                const tuition = (s.finance?.tuition !== undefined && s.finance.tuition !== '')
                    ? Number(s.finance.tuition) : (Number(accountantFinance.defaults[s.classId]) || 0);
                const transportTotal = Object.values(s.finance?.transportHistory || {}).reduce((sum, t) => sum + (Number(t.amount||0) - Number(t.discount||0)), 0);
                const discount = Number(s.finance?.discount) || 0;
                const netRequired = (tuition + transportTotal) - discount;
                const totalPaid = (accountantFinance.revenues || []).filter(r => String(r.studentUid) === String(s.uid)).reduce((sum, r) => sum + (Number(r.amount)||0), 0);

                // Per-installment status
                let runningExpected = 0;
                let overallStatus = 'paid'; // assume paid until proven otherwise
                const instCells = [];

                instCols.forEach(col => {
                    const instAmount = (netRequired * col.pct) / 100;
                    runningExpected += instAmount;
                    let status, label, bg, color;

                    if (!col.date) {
                        // No date set
                        if (totalPaid >= runningExpected) { status = 'paid'; }
                        else { status = 'not_due'; }
                    } else if (col.date > now) {
                        const daysLeft = Math.ceil((col.date - now) / (1000 * 3600 * 24));
                        if (totalPaid >= runningExpected) { status = 'paid'; }
                        else if (daysLeft <= 7) { status = 'due_soon'; }
                        else { status = 'not_due'; }
                    } else {
                        // Past due
                        if (totalPaid >= runningExpected) { status = 'paid'; }
                        else { status = 'overdue'; }
                    }

                    const _badge = (icon, text, bg, col, border) =>
                        `<div style="display:inline-flex;align-items:center;gap:4px;background:${bg};color:${col};border:1px solid ${border};border-radius:999px;padding:2px 7px;font-size:0.67rem;font-weight:800;white-space:nowrap;">
                            <i class="fa-solid ${icon}" style="font-size:0.6rem;"></i>${text}
                        </div>`;

                    switch(status) {
                        case 'paid':
                            label = _badge('fa-circle-check','مسدد','#dcfce7','#15803d','#bbf7d0');
                            bg = '#f0fdf4'; color = '#15803d'; kpiPaid++; break;
                        case 'overdue':
                            label = _badge('fa-circle-exclamation','متأخر','#fff1f2','#be123c','#fecdd3');
                            bg = '#fff8f8'; color = '#be123c'; kpiOverdue++;
                            if(overallStatus !== 'overdue') overallStatus = 'overdue'; break;
                        case 'due_soon':
                            label = _badge('fa-bell','موعده قريب','#fef9c3','#92400e','#fde68a');
                            bg = '#fffdf0'; color = '#92400e'; kpiSoon++;
                            if(overallStatus === 'paid') overallStatus = 'due_soon'; break;
                        case 'not_due':
                            label = _badge('fa-clock','لم يحن بعد','#eff6ff','#1d4ed8','#bfdbfe');
                            bg = '#f8faff'; color = '#1d4ed8'; kpiNotDue++;
                            if(overallStatus === 'paid') overallStatus = 'not_due'; break;
                    }
                    instCells.push({ status, label, bg, color, amount: instAmount });
                });

                // Overall badge
                let overallBadge;
                const _oBadge = (icon, text, bg, col, border) =>
                    `<div style="display:inline-flex;align-items:center;gap:4px;background:${bg};color:${col};border:1px solid ${border};border-radius:999px;padding:3px 9px;font-size:0.68rem;font-weight:900;">
                        <i class="fa-solid ${icon}" style="font-size:0.62rem;"></i>${text}
                    </div>`;
                if (netRequired === 0)            { overallBadge = _oBadge('fa-minus','لا يوجد قسط','#f1f5f9','#64748b','#e2e8f0'); }
                else if (totalPaid >= netRequired) { overallBadge = _oBadge('fa-circle-check','مسدد بالكامل','#dcfce7','#15803d','#bbf7d0'); }
                else if (overallStatus === 'overdue')  { overallBadge = _oBadge('fa-circle-exclamation','متأخر عن الدفع','#fff1f2','#be123c','#fecdd3'); }
                else if (overallStatus === 'due_soon') { overallBadge = _oBadge('fa-bell','موعده قريب','#fef9c3','#92400e','#fde68a'); }
                else { overallBadge = _oBadge('fa-clock','لم يحن بعد','#eff6ff','#1d4ed8','#bfdbfe'); }

                // Apply status filter
                if (filterStatus !== 'all') {
                    const hasMatchingCell = instCells.some(c => c.status === filterStatus);
                    if (!hasMatchingCell) return;
                }

                // Apply installment filter (show only specific col if selected)
                let cellsHtml = '';
                instCells.forEach((cell, idx) => {
                    if (filterNum !== 'all' && (idx + 1) !== Number(filterNum)) return;
                    cellsHtml += `<td style="text-align:center; background:${cell.bg}; padding:7px 6px; border-bottom:1px solid #f1f5f9; border-left:1px solid #f1f5f9;">
                        ${cell.label}
                        <div style="font-size:0.65rem; color:#64748b; margin-top:3px; font-weight:700;">${cell.amount.toLocaleString('en-US', {maximumFractionDigits:0})} د.ع</div>
                    </td>`;
                });

                const rowIdx = rows.length;
                const rowBg  = rowIdx % 2 === 0 ? '#ffffff' : '#f8fafc';

                rows.push(`<tr style="background:${rowBg}; transition:background 0.15s;"
                    onmouseover="this.style.background='#eff6ff'"
                    onmouseout="this.style.background='${rowBg}'">
                    <td style="padding:8px 10px; border-bottom:1px solid #f1f5f9; border-left:1px solid #f1f5f9;">
                        <div style="font-weight:800; color:#0f172a; font-size:0.82rem;">${s.name}</div>
                        <button onclick="sendWhatsAppReminder('${s.uid}')" title="تنبيه واتساب"
                            style="margin-top:3px; background:#25d366; color:#fff; border:none; border-radius:5px; padding:1px 7px; cursor:pointer; font-size:0.67rem; display:inline-flex; align-items:center; gap:3px;">
                            <i class="fa-brands fa-whatsapp"></i> تنبيه
                        </button>
                    </td>
                    <td style="padding:8px 8px; font-size:0.72rem; color:#475569; font-weight:600; border-bottom:1px solid #f1f5f9; border-left:1px solid #f1f5f9;">${getClassName(s.classId)}</td>
                    <td style="padding:8px 8px; text-align:center; font-weight:900; color:#1e3a8a; font-size:0.82rem; border-bottom:1px solid #f1f5f9; border-left:1px solid #f1f5f9;">${netRequired.toLocaleString('en-US')} <span style="font-size:0.65rem; font-weight:700; color:#64748b;">د.ع</span></td>
                    ${cellsHtml}
                    <td style="padding:8px 8px; text-align:center; border-bottom:1px solid #f1f5f9;">${overallBadge}</td>
                </tr>`);
            });

            // Render KPIs
            const kpiRow = document.getElementById('inst-kpi-row');
            if (kpiRow) {
                kpiRow.innerHTML = [
                    { label: 'متأخرون', val: kpiOverdue, bg: '#fff1f2', color: '#dc2626', icon: 'fa-circle-exclamation' },
                    { label: 'موعد قريب', val: kpiSoon,    bg: '#fffbeb', color: '#d97706', icon: 'fa-bell' },
                    { label: 'مسددة',    val: kpiPaid,    bg: '#f0fdf4', color: '#059669', icon: 'fa-circle-check' },
                    { label: 'لم يحن',   val: kpiNotDue,  bg: '#f8fafc', color: '#94a3b8', icon: 'fa-clock' },
                    { label: 'إجمالي الطلاب', val: accountantStudents.length, bg: '#eff6ff', color: '#1d4ed8', icon: 'fa-users' },
                ].map(k => `<div style="background:${k.bg};border:1px solid ${k.color}30;border-radius:8px;padding:7px 6px;text-align:center;">
                    <i class="fa-solid ${k.icon}" style="color:${k.color};font-size:0.9rem;"></i>
                    <div style="font-size:1.1rem;font-weight:900;color:${k.color};margin:2px 0;">${k.val}</div>
                    <div style="font-size:0.65rem;color:#64748b;font-weight:700;">${k.label}</div>
                </div>`).join('');
            }

            // Update summary
            const summaryEl = document.getElementById('inst-tab-summary');
            if (summaryEl) summaryEl.innerText = `${rows.length} طالب — ${kpiOverdue} متأخر — ${kpiSoon} موعد قريب`;

            // Render tbody
            const tbody = document.getElementById('acc-installments-tbody');
            if (tbody) tbody.innerHTML = rows.length ? rows.join('') : `<tr><td colspan="${3 + instCount + 1}" style="text-align:center;padding:50px;color:#94a3b8;"><i class="fa-solid fa-check-circle" style="font-size:2rem;display:block;margin-bottom:10px;color:#10b981;"></i>لا توجد نتائج بهذه الفلترة</td></tr>`;
        };

        window.printInstallmentSchedule = function() {
            const g = accountantFinance.globalDates || {};
            const p = accountantFinance.globalPercents || {};
            const instCount = accountantFinance.installmentCount || 5;
            const now = new Date();
            const branch = (window.NAHRAIN_BRANCHES?.[currentUser?.branchId]) || { name: 'مدرسة النهرين' };

            const instCols = [];
            for (let i = 1; i <= instCount; i++) {
                const dateStr = g['inst' + i] || '';
                const pct = Number(p['p' + i]) || (100 / instCount);
                instCols.push({ num: i, date: dateStr ? new Date(dateStr) : null, dateStr, pct });
            }

            let tableRows = '';
            accountantStudents.forEach((s, idx) => {
                const tuition = (s.finance?.tuition !== undefined && s.finance.tuition !== '') ? Number(s.finance.tuition) : (Number(accountantFinance.defaults[s.classId]) || 0);
                const transportTotal = Object.values(s.finance?.transportHistory || {}).reduce((sum, t) => sum + (Number(t.amount||0) - Number(t.discount||0)), 0);
                const discount = Number(s.finance?.discount) || 0;
                const netRequired = (tuition + transportTotal) - discount;
                const totalPaid = (accountantFinance.revenues || []).filter(r => String(r.studentUid) === String(s.uid)).reduce((sum, r) => sum + (Number(r.amount)||0), 0);

                let runningExpected = 0;
                let cellsHtml = '';
                instCols.forEach(col => {
                    const instAmount = (netRequired * col.pct) / 100;
                    runningExpected += instAmount;
                    let status;
                    if (!col.date || col.date > now) {
                        status = totalPaid >= runningExpected ? 'paid' : (!col.date || (col.date - now) > 7 * 86400000) ? 'not_due' : 'due_soon';
                    } else {
                        status = totalPaid >= runningExpected ? 'paid' : 'overdue';
                    }
                    const statusMap = { paid: { t: '✅ مسدد', c: '#059669', bg: '#f0fdf4' }, overdue: { t: '🔴 متأخر', c: '#dc2626', bg: '#fee2e2' }, due_soon: { t: '🟡 قريب', c: '#d97706', bg: '#fffbeb' }, not_due: { t: '⬜ لم يحن', c: '#94a3b8', bg: '#f8fafc' } };
                    const st = statusMap[status];
                    cellsHtml += `<td style="text-align:center;background:${st.bg};color:${st.c};font-weight:800;font-size:0.8rem;padding:6px 4px;">${st.t}<br><small style="color:#64748b;font-weight:600;">${instAmount.toLocaleString('en-US',{maximumFractionDigits:0})}</small></td>`;
                });

                tableRows += `<tr style="${idx%2===0?'':'background:#f8fafc;'}">
                    <td style="font-weight:700;">${idx+1}. ${s.name}</td>
                    <td style="font-size:0.78rem;color:#64748b;">${getClassName(s.classId)}</td>
                    <td style="text-align:center;font-weight:800;">${netRequired.toLocaleString('en-US')}</td>
                    <td style="text-align:center;color:#059669;font-weight:800;">${totalPaid.toLocaleString('en-US')}</td>
                    ${cellsHtml}
                </tr>`;
            });

            const thInst = instCols.map(col => `<th style="text-align:center;min-width:90px;">ق${col.num} (${col.pct.toFixed(0)}%)<br><small>${col.dateStr ? new Date(col.dateStr).toLocaleDateString('ar-IQ') : 'بدون موعد'}</small></th>`).join('');

            const pw = window.open('', '_blank');
            if (!pw) return alert('يرجى السماح بالنوافذ المنبثقة');
            pw.document.write(`<!DOCTYPE html><html dir="rtl"><head><title>جدول الأقساط - ${window.currentAcademicYear}</title>
            <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap" rel="stylesheet">
            <style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'Cairo',sans-serif;padding:15px;color:#1e293b;font-size:11px;}
            .no-print{background:#1e3a8a;color:#fff;padding:10px;text-align:center;margin-bottom:15px;position:sticky;top:0;z-index:100;}
            .no-print button{background:#fff;color:#1e3a8a;border:none;padding:6px 25px;font-family:'Cairo';font-weight:800;cursor:pointer;border-radius:5px;}
            h2{color:#1e3a8a;text-align:center;margin-bottom:5px;font-size:1rem;}
            .meta{text-align:center;color:#64748b;font-size:0.75rem;margin-bottom:12px;}
            table{width:100%;border-collapse:collapse;}
            th{background:#1e3a8a;color:#fff;padding:7px 5px;text-align:right;border:1px solid #1e3a8a;font-size:0.78rem;}
            td{border:1px solid #cbd5e1;padding:6px 5px;vertical-align:middle;}
            @media print{.no-print{display:none!important;}@page{size:A4 landscape;margin:8mm;}}
            </style></head><body>
            <div class="no-print"><button onclick="window.print()">🖨️ طباعة جدول الأقساط</button></div>
            <h2>${branch.name} — جدول مواعيد الأقساط الدراسية</h2>
            <p class="meta">العام الدراسي: ${window.currentAcademicYear} | تاريخ الاستخراج: ${now.toLocaleDateString('ar-IQ')} | المحاسب: ${currentUser?.name || '---'}</p>
            <table><thead><tr>
                <th>الطالب</th><th>الشعبة</th><th style="text-align:center;">الإجمالي</th><th style="text-align:center;">المسدد</th>
                ${thInst}
            </tr></thead><tbody>${tableRows}</tbody></table>
            </body></html>`);
            pw.document.close();
            setTimeout(() => { if(pw && !pw.closed) pw.print(); }, 600);
        };
        // ============ END INSTALLMENT SCHEDULE ============

        function renderAccountantUI() {
            renderFinancialSettings();
            try {
                const expDateInput = document.getElementById('acc-exp-manual-date');
                if (expDateInput && !expDateInput.value) expDateInput.value = new Date().toISOString().split('T')[0];
                
                let totalRevenues = 0;
                let totalExpenses = 0;
                const studentPayments = {};

                (accountantFinance.revenues || []).forEach(r => {
                    const amt = Number(r.amount) || 0;
                    totalRevenues += amt;
                    if (r.studentUid) studentPayments[r.studentUid] = (studentPayments[r.studentUid] || 0) + amt;
                });

                (accountantFinance.expenses || []).forEach(e => {
                    totalExpenses += Number(e.amount) || 0;
                });

                const revEl = document.getElementById('acc-total-revenues');
                if (revEl) revEl.innerText = totalRevenues.toLocaleString('en-US');
                const expEl = document.getElementById('acc-total-expenses');
                if (expEl) expEl.innerText = totalExpenses.toLocaleString('en-US');
                const netEl = document.getElementById('acc-net-balance');
                if (netEl) netEl.innerText = (totalRevenues - totalExpenses).toLocaleString('en-US');

                const expCatSelect = document.getElementById('acc-exp-category');
                const expFilterCatSelect = document.getElementById('acc-exp-filter-category');

                if (expCatSelect) {
                    let catHtml = '';
                    (accountantFinance.expenseCategories || []).forEach(c => { catHtml += `<option value="${c}">${c}</option>`; });
                    expCatSelect.innerHTML = catHtml;
                }

                if (expFilterCatSelect) {
                    let currentFilter = expFilterCatSelect.value;
                    let filterHtml = '<option value="all">جميع الأبواب</option>';
                    (accountantFinance.expenseCategories || []).forEach(c => { filterHtml += `<option value="${c}">${c}</option>`; });
                    expFilterCatSelect.innerHTML = filterHtml;
                    if (currentFilter) expFilterCatSelect.value = currentFilter;
                }

                const catList = document.getElementById('acc-categories-list');
                if (catList) {
                    catList.innerHTML = '';
                    (accountantFinance.expenseCategories || []).forEach(cat => {
                        catList.innerHTML += `<span class="acc-badge" style="background:#e8f5e9; color:#2e7d32; border:1px solid #c8e6c9; padding:5px 12px; font-size:0.85rem; margin:2px; display:inline-block;">${cat} <i class="fa-solid fa-xmark" style="cursor:pointer; margin-right:8px; color:#c62828;" onclick="removeExpenseCategory('${cat}')"></i></span>`;
                    });
                }

                const accDeptSelect = document.getElementById('acc-filter-dept');
                if (accDeptSelect && accDeptSelect.options.length <= 1 && window.schoolStructure) {
                    window.schoolStructure.forEach((dept, dIdx) => {
                        accDeptSelect.innerHTML += `<option value="${dIdx}" style="background:#1e293b;color:#fff;">${dept.name}</option>`;
                    });
                }

                const tbodyStd = document.querySelector('#acc-students-table tbody');
                const cardsContainer = document.getElementById('acc-students-cards');
                if (cardsContainer) {
                    if (accountantStudents.length === 0) {
                        cardsContainer.innerHTML = `<div style="text-align:center;padding:60px 20px;color:#94a3b8;"><i class="fa-solid fa-user-slash" style="font-size:3rem;display:block;margin-bottom:15px;color:#cbd5e1;"></i><div style="font-size:1rem;font-weight:700;">لا يوجد طلاب مسجلين بعد</div></div>`;
                    } else {
                        let kpiLate = 0, kpiDone = 0, kpiDebt = 0;
                        let cardsData = [];

                        accountantStudents.forEach(s => {
                            let paid = studentPayments[s.uid] || 0;
                            let tuition = (s.finance && s.finance.tuition !== undefined && s.finance.tuition !== "") ? Number(s.finance.tuition) : (Number(accountantFinance.defaults[s.classId]) || 0);
                            const transportHistory = s.finance?.transportHistory || {};
                            const transportTotal = Object.values(transportHistory).reduce((sum, item) => sum + ((Number(item.amount) || 0) - (Number(item.discount) || 0)), 0);
                            let discount = Number(s.finance?.discount) || 0;
                            let netRequired = (tuition + transportTotal) - discount;
                            let remaining = netRequired - paid;
                            let readableClass = getClassName(s.classId);

                            let isLate = false;
                            const now = new Date();
                            const instCount = accountantFinance.installmentCount || 5;
                            const g = accountantFinance.globalDates || {};
                            if (remaining > 0) {
                                // Use instCount dynamically — not hardcoded to 5
                                for (let i = 1; i <= instCount; i++) {
                                    const d = g['inst' + i];
                                    if (d && new Date(d) < now) {
                                        const expectedByNow = (netRequired / instCount) * i;
                                        if (paid < expectedByNow) { isLate = true; break; }
                                    }
                                }
                            }

                            if (isLate) kpiLate++;
                            if (remaining <= 0) kpiDone++;
                            if (remaining > 0) kpiDebt += remaining;

                            cardsData.push({ s, paid, netRequired, remaining, readableClass, isLate });
                        });

                        // Update KPIs
                        const upd = (id, v) => { const e = document.getElementById(id); if(e) e.innerText = v; };
                        upd('std-kpi-count', cardsData.length);
                        upd('std-kpi-late-n', kpiLate);
                        upd('std-kpi-done-n', kpiDone);
                        upd('std-kpi-debt-total', kpiDebt.toLocaleString('en-US'));

                        // Sort
                        const sortMode = document.getElementById('acc-sort-students')?.value || 'name';
                        if (sortMode === 'debt_desc') cardsData.sort((a,b) => b.remaining - a.remaining);
                        else if (sortMode === 'late') cardsData.sort((a,b) => (b.isLate?1:0)-(a.isLate?1:0));
                        else if (sortMode === 'paid') cardsData.sort((a,b) => (a.remaining<=0?-1:1)-(b.remaining<=0?-1:1));
                        else cardsData.sort((a,b) => (a.s.name||'').localeCompare(b.s.name||'', 'ar'));

                        // Generate cards
                        let htmlCards = '';
                        cardsData.forEach(({ s, paid, netRequired, remaining, readableClass, isLate }) => {
                            const pctPaid = netRequired > 0 ? Math.min(100, Math.round((paid / netRequired) * 100)) : 100;
                            const avatarLetter = (s.name || '?')[0];
                            const avatarColors = ['#1e3a8a,#3b82f6','#065f46,#10b981','#7c3aed,#a78bfa','#92400e,#f59e0b','#9f1239,#f43f5e'];
                            const colorIdx = avatarLetter.charCodeAt(0) % avatarColors.length;
                            const avatarGrad = avatarColors[colorIdx];

                            // Status config
                            let borderColor, statusBg, statusColor, statusIcon, statusText, cardBg;
                            if (remaining <= 0) {
                                borderColor='#22c55e'; statusBg='#f0fdf4'; statusColor='#15803d';
                                statusIcon='fa-crown'; statusText='مسدد بالكامل'; cardBg='#f0fdf4';
                            } else if (isLate) {
                                borderColor='#ef4444'; statusBg='#fff1f2'; statusColor='#dc2626';
                                statusIcon='fa-bolt-lightning'; statusText='متأخر عن الدفع'; cardBg='#fff8f8';
                            } else {
                                borderColor='#3b82f6'; statusBg='#eff6ff'; statusColor='#2563eb';
                                statusIcon='fa-hourglass-half'; statusText='لم يحن بعد'; cardBg='#fff';
                            }

                            // SVG circular progress
                            const r = 22, circ = 2 * Math.PI * r;
                            const dash = circ * (1 - pctPaid / 100);
                            const svgColor = remaining <= 0 ? '#22c55e' : isLate ? '#ef4444' : '#3b82f6';

                            htmlCards += `
                            <div class="acc-row" data-class-id="${s.classId || ''}" data-name="${(s.name||'').toLowerCase()}"
                                style="background:${cardBg}; border:1px solid #e2e8f0; border-right:4px solid ${borderColor}; border-radius:16px; padding:16px 20px; display:flex; align-items:center; gap:16px; transition:all 0.25s; cursor:default; box-shadow:0 1px 3px rgba(0,0,0,0.06);"
                                onmouseover="this.style.boxShadow='0 8px 30px rgba(0,0,0,0.12)';this.style.transform='translateY(-2px)'"
                                onmouseout="this.style.boxShadow='0 1px 3px rgba(0,0,0,0.06)';this.style.transform='translateY(0)'">

                                <!-- Avatar -->
                                <div style="flex-shrink:0; width:48px; height:48px; border-radius:14px; background:linear-gradient(135deg,${avatarGrad}); display:flex; align-items:center; justify-content:center; color:#fff; font-weight:900; font-size:1.3rem; box-shadow:0 4px 12px rgba(0,0,0,0.15);">
                                    ${avatarLetter}
                                </div>

                                <!-- Name & Class -->
                                <div style="flex:1; min-width:140px;">
                                    <div style="font-weight:900; color:#0f172a; font-size:0.95rem; line-height:1.3;">${s.name || 'غير محدد'}</div>
                                    <div style="font-size:0.72rem; color:#94a3b8; margin-top:3px; font-weight:600;">${readableClass}</div>
                                    <div style="margin-top:6px; display:inline-flex; align-items:center; gap:5px; background:${statusBg}; border:1px solid ${borderColor}40; color:${statusColor}; padding:2px 8px; border-radius:20px; font-size:0.68rem; font-weight:800;">
                                        <i class="fa-solid ${statusIcon}" style="font-size:0.65rem;"></i> ${statusText}
                                    </div>
                                </div>

                                <!-- Financial Stats -->
                                <div style="display:flex; gap:8px; flex-shrink:0;">
                                    <div style="text-align:center; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:8px 14px; min-width:90px;">
                                        <div style="font-size:0.62rem; color:#94a3b8; font-weight:700; margin-bottom:3px; text-transform:uppercase;">المطلوب</div>
                                        <div style="font-weight:900; color:#475569; font-size:0.88rem;">${netRequired.toLocaleString('en-US')}</div>
                                        <div style="font-size:0.6rem; color:#cbd5e1;">د.ع</div>
                                    </div>
                                    <div style="text-align:center; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:10px; padding:8px 14px; min-width:90px;">
                                        <div style="font-size:0.62rem; color:#16a34a; font-weight:700; margin-bottom:3px; text-transform:uppercase;">المسدد</div>
                                        <div style="font-weight:900; color:#059669; font-size:0.88rem;">${paid.toLocaleString('en-US')}</div>
                                        <div style="font-size:0.6rem; color:#86efac;">د.ع</div>
                                    </div>
                                    <div style="text-align:center; background:${remaining>0?'#fff1f2':'#f0fdf4'}; border:1px solid ${remaining>0?'#fecdd3':'#bbf7d0'}; border-radius:10px; padding:8px 14px; min-width:90px;">
                                        <div style="font-size:0.62rem; color:${remaining>0?'#dc2626':'#059669'}; font-weight:700; margin-bottom:3px; text-transform:uppercase;">المتبقي</div>
                                        <div style="font-weight:900; color:${remaining>0?'#dc2626':'#059669'}; font-size:0.88rem;">${Math.max(0,remaining).toLocaleString('en-US')}</div>
                                        <div style="font-size:0.6rem; color:${remaining>0?'#fca5a5':'#86efac'};">د.ع</div>
                                    </div>
                                </div>

                                <!-- Circular Progress -->
                                <div style="flex-shrink:0; text-align:center; position:relative;">
                                    <svg width="60" height="60" viewBox="0 0 60 60">
                                        <circle cx="30" cy="30" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="5"/>
                                        <circle cx="30" cy="30" r="${r}" fill="none" stroke="${svgColor}" stroke-width="5"
                                            stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${dash.toFixed(1)}"
                                            stroke-linecap="round" transform="rotate(-90 30 30)"
                                            style="transition:stroke-dashoffset 0.6s ease;"/>
                                        <text x="30" y="35" text-anchor="middle" font-size="11" font-weight="900" fill="${svgColor}" font-family="Cairo,sans-serif">${pctPaid}%</text>
                                    </svg>
                                </div>

                                <!-- Action Buttons -->
                                <div style="flex-shrink:0; display:flex; flex-direction:column; gap:6px; align-items:flex-end;">
                                    <button onclick="window.openAccStudentPayment('${s.uid}')"
                                        style="background:linear-gradient(135deg,#1e3a8a,#2563eb); color:#fff; border:none; border-radius:10px; padding:7px 16px; cursor:pointer; font-size:0.8rem; font-weight:800; display:flex; align-items:center; gap:6px; white-space:nowrap; box-shadow:0 4px 12px rgba(37,99,235,0.3); transition:transform 0.15s;"
                                        onmouseover="this.style.transform='scale(1.04)'" onmouseout="this.style.transform='scale(1)'">
                                        <i class="fa-solid fa-plus-circle"></i> تسديد
                                    </button>
                                    <div style="display:flex; gap:5px;">
                                        <button onclick="window.openAccStudentStatement('${s.uid}')" title="كشف الحساب"
                                            style="background:#f1f5f9; color:#64748b; border:1px solid #e2e8f0; border-radius:8px; width:30px; height:30px; cursor:pointer; font-size:0.78rem; display:flex; align-items:center; justify-content:center; transition:all 0.15s;"
                                            onmouseover="this.style.background='#1e3a8a';this.style.color='#fff'" onmouseout="this.style.background='#f1f5f9';this.style.color='#64748b'">
                                            <i class="fa-solid fa-chart-simple"></i>
                                        </button>
                                        <button onclick="window.openAccStudentManage('${s.uid}')" title="إعدادات"
                                            style="background:#f1f5f9; color:#64748b; border:1px solid #e2e8f0; border-radius:8px; width:30px; height:30px; cursor:pointer; font-size:0.78rem; display:flex; align-items:center; justify-content:center; transition:all 0.15s;"
                                            onmouseover="this.style.background='#7c3aed';this.style.color='#fff'" onmouseout="this.style.background='#f1f5f9';this.style.color='#64748b'">
                                            <i class="fa-solid fa-sliders"></i>
                                        </button>
                                        <button onclick="sendWhatsAppReminder('${s.uid}')" title="تذكير واتساب"
                                            style="background:#f1f5f9; color:#64748b; border:1px solid #e2e8f0; border-radius:8px; width:30px; height:30px; cursor:pointer; font-size:0.78rem; display:flex; align-items:center; justify-content:center; transition:all 0.15s;"
                                            onmouseover="this.style.background='#25d366';this.style.color='#fff'" onmouseout="this.style.background='#f1f5f9';this.style.color='#64748b'">
                                            <i class="fa-brands fa-whatsapp"></i>
                                        </button>
                                        <button onclick="window.shareReceiptWhatsApp('${s.uid}')" title="مشاركة الوصل"
                                            style="background:#f1f5f9; color:#64748b; border:1px solid #e2e8f0; border-radius:8px; width:30px; height:30px; cursor:pointer; font-size:0.78rem; display:flex; align-items:center; justify-content:center; transition:all 0.15s;"
                                            onmouseover="this.style.background='#0ea5e9';this.style.color='#fff'" onmouseout="this.style.background='#f1f5f9';this.style.color='#64748b'">
                                            <i class="fa-solid fa-paper-plane"></i>
                                        </button>
                                    </div>
                                </div>
                            </div>`;
                        });
                        cardsContainer.innerHTML = htmlCards;
                    }
                }
                
                const tbodyRev = document.querySelector('#acc-revenues-table tbody');
                const revFilteredSummary = document.getElementById('acc-rev-filtered-summary');
                const revFilteredTotalSpan = document.getElementById('acc-rev-filtered-total');

                if(tbodyRev) {
                    let revHtml = '';
                    let filteredRevTotal = 0;
                    let fromDate = document.getElementById('acc-rev-date-from')?.value;
                    let toDate = document.getElementById('acc-rev-date-to')?.value;

                    [...accountantFinance.revenues].sort((a,b) => (b?.timestamp || 0) - (a?.timestamp || 0)).forEach(r => {
                        if(!r) return;
                        let dateObj = new Date(r.timestamp);
                        
                        // Apply Filters
                        if (fromDate && dateObj < new Date(fromDate)) return;
                        if (toDate && dateObj > new Date(toDate + 'T23:59:59')) return;

                        filteredRevTotal += Number(r.amount || 0);
                        // Store data in a cache and reference by index — avoids injecting strings into onclick
                        if (!window._revCache) window._revCache = {};
                        window._revCache[r.id] = r;
                        revHtml += `
                            <tr>
                                <td style="font-size:0.75rem; color:#64748b; font-weight:700;">${escHtml(r.receiptNum || '-')}</td>
                                <td>${dateObj.toLocaleString('en-US')}</td>
                                <td>${escHtml(r.note || '-')}</td>
                                <td><span class="acc-badge badge-success">${Number(r.amount || 0).toLocaleString('en-US')} د.ع</span></td>
                                <td>${escHtml(r.addedBy || 'المحاسب')}</td>
                                <td>
                                    <div style="display:flex; gap:5px;">
                                        <button class="quick-action-btn" onclick="_openRevEdit('${r.id}')" title="تعديل"><i class="fa-solid fa-pen-to-square"></i></button>
                                        <button class="quick-action-btn" style="background:#475569; color:white;" onclick="_printRev('${r.id}')" title="طباعة"><i class="fa-solid fa-print"></i></button>
                                        <button class="quick-action-btn" style="background:#fee2e2; color:#dc2626;" onclick="deleteAccTransaction('${r.id}', 'revenue')" title="حذف"><i class="fa-solid fa-trash"></i></button>
                                    </div>
                                </td>
                            </tr>`;
                    });
                    tbodyRev.innerHTML = revHtml || '<tr><td colspan="6" style="text-align:center; padding:20px; color:#94a3b8;">لا توجد مقبوضات تطابق البحث</td></tr>';

                    if (revFilteredSummary && revFilteredTotalSpan) {
                        revFilteredTotalSpan.innerText = filteredRevTotal.toLocaleString('en-US');
                        revFilteredSummary.style.display = (fromDate || toDate) ? 'flex' : 'none';
                    }
                }
                
                const tbodyExp = document.querySelector('#acc-expenses-table tbody');
                const expFilteredSummary = document.getElementById('acc-exp-filtered-summary');
                const expFilteredTotalSpan = document.getElementById('acc-exp-filtered-total');
                
                if(tbodyExp) {
                    let expHtml = '';
                    let filteredExpTotal = 0;
                    let fromDate = document.getElementById('acc-exp-date-from')?.value;
                    let toDate = document.getElementById('acc-exp-date-to')?.value;
                    let catFilter = document.getElementById('acc-exp-filter-category')?.value;

                    [...accountantFinance.expenses].sort((a,b) => (b?.timestamp || 0) - (a?.timestamp || 0)).forEach(e => {
                        if(!e) return;
                        let dateObj = new Date(e.timestamp);
                        
                        // Apply Filters
                        if (fromDate && dateObj < new Date(fromDate)) return;
                        if (toDate && dateObj > new Date(toDate + 'T23:59:59')) return;
                        if (catFilter && catFilter !== 'all' && e.category !== catFilter) return;

                        filteredExpTotal += Number(e.amount || 0);
                        if (!window._expCache) window._expCache = {};
                        window._expCache[e.id] = e;
                        expHtml += `
                            <tr>
                                <td style="font-size:0.75rem; color:#64748b; font-weight:700;">${escHtml(e.receiptNum || '-')}</td>
                                <td style="font-size:0.8rem;">${dateObj.toLocaleDateString('ar-IQ')}</td>
                                <td><span class="acc-badge" style="background:#f1f5f9; color:#475569;">${escHtml(e.category || 'أخرى')}</span></td>
                                <td style="font-weight:bold; color:#1e293b;">${escHtml(e.payee || '-')}</td>
                                <td style="font-size:0.85rem; color:#64748b;">${escHtml(e.note || '-')} ${e.refNum ? `<br><small style="color:#94a3b8;">Ref: ${escHtml(e.refNum)}</small>` : ''}</td>
                                <td><span class="acc-badge badge-danger" style="font-weight:800;">${Number(e.amount || 0).toLocaleString('en-US')} د.ع</span></td>
                                <td style="font-size:0.75rem; color:#94a3b8;">${escHtml(e.addedBy || 'المحاسب')}</td>
                                <td>
                                    <div style="display:flex; gap:5px;">
                                        <button class="quick-action-btn" onclick="_openExpEdit('${e.id}')" title="تعديل"><i class="fa-solid fa-pen-to-square"></i></button>
                                        <button class="quick-action-btn" style="background:#475569; color:white;" onclick="_printExp('${e.id}')" title="طباعة السند"><i class="fa-solid fa-print"></i></button>
                                        <button class="quick-action-btn" style="background:#fee2e2; color:#dc2626;" onclick="deleteAccTransaction('${e.id}', 'expense')" title="حذف"><i class="fa-solid fa-trash"></i></button>
                                    </div>
                                </td>
                            </tr>`;
                    });
                    
                    tbodyExp.innerHTML = expHtml || '<tr><td colspan="7" style="text-align:center; padding:20px; color:#94a3b8;">لا توجد مصروفات تطابق البحث</td></tr>';
                    
                    // Update Filtered Total Summary
                    if (expFilteredSummary && expFilteredTotalSpan) {
                        expFilteredTotalSpan.innerText = filteredExpTotal.toLocaleString('en-US');
                        expFilteredSummary.style.display = (fromDate || toDate || (catFilter && catFilter !== 'all')) ? 'flex' : 'none';
                    }
                }
                
                const tbodyHR = document.querySelector('#acc-hr-table tbody');
                if (tbodyHR) {
                    let hrHtml = '';
                    if (accountantStaff.length === 0) {
                        hrHtml = '<tr><td colspan="7" style="text-align:center; padding:20px; color:#94a3b8;">لا يوجد موظفون مسجلون في هذا الفرع.</td></tr>';
                    } else {
                        accountantStaff.forEach(s => {
                            const b = Number(s.payroll?.base) || 0;
                            const a = Number(s.payroll?.allowance) || 0;
                            const d = Number(s.payroll?.deduction) || 0;
                            const net = (b + a) - d;
                            const roleAr = s.role === 'teacher' ? 'مدرس' : (s.role === 'accountant' ? 'محاسب' : (s.role === 'admin' ? 'مدير' : 'إداري'));
                            const safeName = (s.name || '').replace(/'/g, "\\'");
                            
                            hrHtml += `
                                <tr>
                                    <td><div style="font-weight:700; color:#1e293b;">${s.name || '---'}</div></td>
                                    <td><span class="acc-badge" style="background:#f1f5f9; color:#475569;">${roleAr}</span></td>
                                    <td style="font-weight:600;">${b.toLocaleString()} د.ع</td>
                                    <td style="color:#059669; font-weight:600;">+ ${a.toLocaleString()}</td>
                                    <td style="color:#dc2626; font-weight:600;">- ${d.toLocaleString()}</td>
                                    <td><div class="status-chip chip-paid" style="font-weight:900;">${net.toLocaleString()} د.ع</div></td>
                                    <td>
                                        <div style="display:flex; gap:8px; justify-content:center;">
                                            <button class="quick-action-btn" style="background:#475569; color:white;" onclick="openAccHRManage('${s.uid}', '${safeName}', '${roleAr}', ${b}, ${a}, ${d}, '${s.payroll?.contractStart || ''}', '${s.payroll?.contractEnd || ''}')" title="إدارة الراتب"><i class="fa-solid fa-calculator"></i></button>
                                            <button class="quick-action-btn" style="background:#f1f5f9; color:#475569;" onclick="window.openSalaryStatement('${s.uid}')" title="سجل الرواتب"><i class="fa-solid fa-receipt"></i></button>
                                        </div>
                                    </td>
                                </tr>`;
                        });
                    }
                    tbodyHR.innerHTML = hrHtml;
                }

                // Render Audit Log
                const tbodyAudit = document.querySelector('#acc-audit-table tbody');
                if (tbodyAudit) {
                    let auditHtml = '';
                    [...accountantFinance.auditLogs].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 50).forEach(l => {
                        let dateStr = l.timestamp ? new Date(l.timestamp).toLocaleString('ar-IQ') : '---';
                        auditHtml += `
                            <tr>
                                <td style="font-size:0.8rem; color:#64748b;">${dateStr}</td>
                                <td style="font-weight:600;">${l.user || 'النظام'}</td>
                                <td><span class="acc-badge" style="background:#f1f5f9; color:#1e293b; font-weight:700;">${l.action || '---'}</span></td>
                                <td style="font-size:0.85rem;">${l.note || '---'}</td>
                                <td><span class="acc-badge" style="background:#e0f2fe; color:#0369a1;">${Number(l.amount || 0).toLocaleString()} د.ع</span></td>
                            </tr>
                        `;
                    });
                    tbodyAudit.innerHTML = auditHtml || '<tr><td colspan="5" style="text-align:center; padding:20px; color:#94a3b8;">لا توجد سجلات عمليات حالياً.</td></tr>';
                }

                // Render Transport Table (All History)
                const tbodyTrans = document.querySelector('#acc-transport-table tbody');
                if (tbodyTrans) {
                    let transHtml = '';
                    let allSubscribers = [];
                    
                    accountantStudents.forEach(s => {
                        const history = s.finance?.transportHistory || {};
                        Object.values(history).forEach(sub => {
                            allSubscribers.push({ student: s, ...sub });
                        });
                    });
                    
                    // Sort by timestamp (newest first)
                    allSubscribers.sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));
                    
                    allSubscribers.forEach(entry => {
                        const s = entry.student;
                        const net = (Number(entry.amount) || 0) - (Number(entry.discount) || 0);
                        transHtml += `
                            <tr>
                                <td>
                                    <div style="font-weight:700; color:#1e293b;">${s.name || '---'}</div>
                                    <div style="font-size:0.75rem; color:#64748b;">${getClassName(s.classId)}</div>
                                </td>
                                <td>
                                    <div style="font-size:0.85rem; color:#b91c1c; font-weight:700;">من ${entry.startDate || '---'}</div>
                                    <div style="font-size:0.85rem; color:#b91c1c; font-weight:700;">إلى ${entry.endDate || '---'}</div>
                                </td>
                                <td>
                                    <div style="display:flex; flex-wrap:wrap; gap:4px;">
                                        <span class="acc-badge" style="background:#eff6ff; color:#1e40af; font-size:0.75rem;">📍 ${entry.area || '---'}</span>
                                        <span class="acc-badge" style="background:#f1f5f9; color:#475569; font-size:0.75rem;">👤 ${entry.driver || '---'}</span>
                                        <span class="acc-badge" style="background:#fdf4ff; color:#86198f; font-size:0.75rem;">🚐 ${entry.vehicle || '---'}</span>
                                        <span class="acc-badge" style="background:#ecfdf5; color:#065f46; font-size:0.75rem;">🔄 ${entry.type || 'ذهاب وإياب'}</span>
                                    </div>
                                </td>
                                <td style="font-weight:700; color:#475569;">${Number(entry.amount || 0).toLocaleString()}</td>
                                <td style="font-weight:700; color:#dc2626;">-${Number(entry.discount || 0).toLocaleString()}</td>
                                <td><div class="status-chip chip-paid" style="font-weight:900; font-size:1rem; background:#1e3a8a; color:#fff;">${net.toLocaleString()} د.ع</div></td>
                            </tr>
                        `;
                    });
                    
                    const now = new Date();
                    tbodyTrans.innerHTML = transHtml || `<tr><td colspan="6" style="text-align:center; padding:20px; color:#94a3b8;">لا يوجد مشتركين مسجلين حالياً</td></tr>`;
                }
            } catch (err) { console.error("UI Render Error:", err); }
        }

        function renderFinancialSettings() {
            const globalDiv = document.getElementById('acc-global-settings');
            if (globalDiv) {
                const g = accountantFinance.globalDates || {};
                const p = accountantFinance.globalPercents || {};
                const count = accountantFinance.installmentCount || 5;

                let html = `
                    <div style="background:#fff; padding:25px; border-radius:15px; border:1px solid #e2e8f0; margin-bottom:20px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
                        <h4 style="margin-top:0; color:#1e3a8a; border-bottom:2px solid #f1f5f9; padding-bottom:10px;"><i class="fa-solid fa-calendar-check"></i> جدولة مواعيد ونسب الأقساط — <span style="color:#dc2626;">${(window.NAHRAIN_BRANCHES && window.NAHRAIN_BRANCHES[currentUser?.branchId]) ? window.NAHRAIN_BRANCHES[currentUser.branchId].name : currentUser?.branchId || ''}</span></h4>
                        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:20px; margin-bottom:20px;">
                `;

                for (let i = 1; i <= 5; i++) {
                    const disabled = i > count ? 'disabled style="opacity:0.4;"' : '';
                    html += `
                        <div ${disabled}>
                            <label style="display:block; font-weight:bold; font-size:0.85rem; margin-bottom:5px;">القسط ${i}:</label>
                            <input type="date" id="acc-global-inst${i}" class="acc-input" value="${g['inst' + i] || ''}" style="margin-bottom:8px;">
                            <div style="display:flex; align-items:center; gap:5px;">
                                <small style="color:#64748b;">النسبة:</small>
                                <input type="number" id="acc-global-p${i}" class="acc-input" placeholder="مثال: 20" value="${p['p' + i] || ''}" style="padding:5px; font-size:0.85rem;">
                                <b>%</b>
                            </div>
                        </div>
                    `;
                }

                html += `
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:center; background:#f8fafc; padding:15px; border-radius:12px; border:1px solid #e2e8f0;">
                            <div style="display:flex; align-items:center; gap:15px;">
                                <label style="font-weight:bold;">عدد الأقساط المعتمدة:</label>
                                <input type="number" id="acc-setting-inst-count" class="acc-input" value="${count}" style="width:70px;" onchange="saveGlobalFinancialSettings()">
                            </div>
                            <div style="font-size:0.8rem; color:#64748b; max-width:300px; line-height:1.4;">
                                * إذا تركت النسب فارغة، سيقسم النظام المبلغ بالتساوي على عدد الأقساط المحددة.
                            </div>
                            <button class="acc-btn-primary" style="background:#1e3a8a; padding:10px 40px; font-weight:bold;" onclick="saveGlobalFinancialSettings()">
                                <i class="fa-solid fa-floppy-disk"></i> حفظ الإعدادات 💾
                            </button>
                        </div>
                    </div>`;
                globalDiv.innerHTML = html;
            }
            
            const tbody = document.getElementById('acc-settings-tbody');
            if (!tbody) return;
            tbody.innerHTML = '';
            if (window.schoolStructure) {
                window.schoolStructure.forEach(dept => {
                    if (dept.stages) {
                        dept.stages.forEach(st => {
                            if (st.sections) {
                                st.sections.forEach(sc => {
                                    let defaultVal = accountantFinance.defaults[sc.id] || 0;
                                    tbody.innerHTML += `<tr><td style="font-weight:bold;">${dept.name} - ${st.name} - ${sc.name}</td><td><input type="number" id="default-tuition-${sc.id}" class="acc-input" value="${defaultVal}" style="width:100%;"></td><td><button class="acc-btn-primary" onclick="saveFinancialDefault('${sc.id}')">حفظ ✅</button></td></tr>`;
                                });
                            }
                        });
                    }
                });
            }
        }

        window.addCanteenTransaction = async function(type) {
            const amount = Number(document.getElementById('acc-canteen-amount').value) || 0;
            const note = document.getElementById('acc-canteen-note').value;
            if (amount <= 0) return showCustomAlert('تنبيه', 'يرجى إدخال المبلغ', 'warning');
            if (!note) return showCustomAlert('تنبيه', 'يرجى إدخال البيان', 'warning');

            try {
                const cat = type === 'revenue' ? 'إيرادات الحانوت' : 'مصروفات الحانوت';
                await window.addAccTransaction(type, null, `[الحانوت] ${note}`, amount, cat);
                document.getElementById('acc-canteen-amount').value = '';
                document.getElementById('acc-canteen-note').value = '';
                showCustomAlert('تم الحفظ', 'تم تسجيل عملية الحانوت بنجاح ✅', 'success');
                loadAccountantData();
            } catch (e) { console.error(e); }
        }

        window.addAccAuditLog = async function(action, note, amount = 0) {
            const userBranchId = currentUser ? currentUser.branchId : 'samawah';
            try {
                await _restPush('finance/auditLogs', {
                    action,
                    note,
                    amount,
                    timestamp: Date.now(),
                    user: currentUser?.name || 'محاسب',
                    branchId: userBranchId
                });
            } catch (e) { console.error("Audit Log Error:", e); }
        }

        async function saveFinancialDefault(sectionId) {
            const input = document.getElementById('default-tuition-' + sectionId);
            let amount = Number(input.value) || 0;
            try {
                await _restSet('financialSettings/defaults/' + sectionId, amount);
                accountantFinance.defaults[sectionId] = amount;
                
                // Add to Audit Log
                if (window.addAccAuditLog) {
                    window.addAccAuditLog('تعديل إعدادات', `تغيير القسط الافتراضي للشعبة (${sectionId}) إلى ${amount.toLocaleString()} د.ع`);
                }
                
                showCustomAlert('تم الحفظ', 'تم تحديث القسط الافتراضي بنجاح ✅', 'success');
            } catch (e) { 
                console.error(e);
                showCustomAlert('خطأ', 'فشل في حفظ البيانات: ' + e.message, 'error');
            }
        }

        function updateAccCharts() {
            // Cash Flow Chart
            const ctxCash = document.getElementById('acc-cashflow-chart');
            if (ctxCash) {
                if (window.accCashflowChartInstance) window.accCashflowChartInstance.destroy();
                let totalRev = accountantFinance.revenues.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
                let totalExp = accountantFinance.expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
                window.accCashflowChartInstance = new Chart(ctxCash, {
                    type: 'bar',
                    data: { 
                        labels: ['المقبوضات', 'المصروفات'], 
                        datasets: [{ 
                            label: 'التدفق النقدي الإجمالي',
                            data: [totalRev, totalExp], 
                            backgroundColor: ['#10b981', '#ef4444'],
                            borderRadius: 8
                        }] 
                    },
                    options: { 
                        responsive: true, 
                        maintainAspectRatio: false,
                        plugins: { legend: { display: true } }
                    }
                });
            }

            // Expenses by Category Chart
            const ctxExp = document.getElementById('acc-expenses-chart');
            if (ctxExp) {
                if (window.accExpensesChartInstance) window.accExpensesChartInstance.destroy();
                
                const catMap = {};
                (accountantFinance.expenses || []).forEach(e => {
                    const cat = e.category || 'أخرى';
                    catMap[cat] = (catMap[cat] || 0) + (Number(e.amount) || 0);
                });

                const labels = Object.keys(catMap);
                const data = Object.values(catMap);

                window.accExpensesChartInstance = new Chart(ctxExp, {
                    type: 'doughnut',
                    data: {
                        labels: labels,
                        datasets: [{
                            data: data,
                            backgroundColor: ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#64748b'],
                            borderWidth: 0
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } }
                        }
                    }
                });
            }
        }

        function updateAccountantDashboardReports() {
            // 1. Calculate General Totals from Students
            let totalExpected = 0;
            let totalPaid = 0;
            let totalDebt = 0;

            accountantStudents.forEach(s => {
                const tuition = (s.finance && s.finance.tuition !== undefined && s.finance.tuition !== "") ? Number(s.finance.tuition) : (Number(accountantFinance.defaults[s.classId]) || 0);
                // Use transportHistory (same as cards/installments) — not legacy transportFee
                const transport = Object.values(s.finance?.transportHistory || {}).reduce((sum, t) => sum + (Number(t.amount||0) - Number(t.discount||0)), 0);
                const discount = Number(s.finance?.discount) || 0;
                const netRequired = (tuition + transport) - discount;
                
                const myPaid = accountantFinance.revenues.filter(r => String(r.studentUid) === String(s.uid)).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
                
                totalExpected += netRequired;
                totalPaid += myPaid;
                totalDebt += (netRequired - myPaid);
            });

            // Update Summary Cards
            const debtEl = document.getElementById('acc-report-total-debt');
            if (debtEl) debtEl.innerText = totalDebt.toLocaleString();
            
            const expectedEl = document.getElementById('acc-report-total-expected');
            if (expectedEl) expectedEl.innerText = totalExpected.toLocaleString();
            
            const rateEl = document.getElementById('acc-report-collection-rate');
            if (rateEl) {
                const rate = totalExpected > 0 ? (totalPaid / totalExpected * 100).toFixed(1) : 0;
                rateEl.innerText = rate + '%';
            }

            const totalExpenses = accountantFinance.expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
            const profitEl = document.getElementById('acc-report-net-profit');
            if (profitEl) profitEl.innerText = (totalPaid - totalExpenses).toLocaleString();

            // 2. Periodic Movement Sums
            const now = new Date();
            const startOfDay = new Date(now.setHours(0,0,0,0)).getTime();
            const oneDay = 24 * 60 * 60 * 1000;
            const startOfWeek = Date.now() - (7 * oneDay);
            const startOfMonth = Date.now() - (30 * oneDay);

            const getSums = (startTime) => {
                const revs = accountantFinance.revenues.filter(r => r.timestamp >= startTime).reduce((sum, r) => sum + (Number(r.amount)||0), 0);
                const exps = accountantFinance.expenses.filter(e => e.timestamp >= startTime).reduce((sum, e) => sum + (Number(e.amount)||0), 0);
                return { in: revs, out: exps };
            };

            const dayStats = getSums(startOfDay);
            const weekStats = getSums(startOfWeek);
            const monthStats = getSums(startOfMonth);

            const setEl = (id, val) => { const e = document.getElementById(id); if (e) e.innerText = val; };
            setEl('acc-rep-daily-in',    dayStats.in.toLocaleString());
            setEl('acc-rep-daily-out',   dayStats.out.toLocaleString());
            setEl('acc-rep-weekly-in',   weekStats.in.toLocaleString());
            setEl('acc-rep-weekly-out',  weekStats.out.toLocaleString());
            setEl('acc-rep-monthly-in',  monthStats.in.toLocaleString());
            setEl('acc-rep-monthly-out', monthStats.out.toLocaleString());

            // 3. Update Charts
            updateAccCharts();

            // 4. Update Inventory Stats Panel
            updateInventoryStats();

            // 5. Payment method breakdown
            updateMethodBreakdown();
        }

        function updateInventoryStats() {
            const totalRevenues = (accountantFinance.revenues || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
            const totalExpenses = (accountantFinance.expenses || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
            const net = totalRevenues - totalExpenses;

            // Total Debts
            let totalDebts = 0;
            accountantStudents.forEach(s => {
                const tuition = (s.finance?.tuition !== undefined && s.finance.tuition !== '') ? Number(s.finance.tuition) : (Number(accountantFinance.defaults[s.classId]) || 0);
                const transportTotal = Object.values(s.finance?.transportHistory || {}).reduce((sum, t) => sum + (Number(t.amount || 0) - Number(t.discount || 0)), 0);
                const discount = Number(s.finance?.discount) || 0;
                const netReq = (tuition + transportTotal) - discount;
                const paid = (accountantFinance.revenues || []).filter(r => String(r.studentUid) === String(s.uid)).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
                if (netReq - paid > 0) totalDebts += (netReq - paid);
            });

            const el = (id, val) => { const e = document.getElementById(id); if (e) e.innerText = val; };
            el('inv-stat-revenues', totalRevenues.toLocaleString('en-US') + ' د.ع');
            el('inv-stat-expenses', totalExpenses.toLocaleString('en-US') + ' د.ع');
            el('inv-stat-debts', totalDebts.toLocaleString('en-US') + ' د.ع');
            el('inv-stat-net', net.toLocaleString('en-US') + ' د.ع');
            el('inv-stat-students', accountantStudents.length);
            el('inv-stat-staff', accountantStaff.length);
        }

        window.printAnnualInventoryReport = function() {
            const userBranchId = currentUser?.branchId || 'samawah';
            const branch = (window.NAHRAIN_BRANCHES && window.NAHRAIN_BRANCHES[userBranchId]) || { name: 'مدرسة النهرين', logo: 'logo.jpg' };
            const selectedYear = document.getElementById('inv-report-year')?.value || new Date().getFullYear();
            const academicYear = window.currentAcademicYear || `${Number(selectedYear) - 1} / ${selectedYear}`;

            // ---- Financial Calculations ----
            const totalRevenues = (accountantFinance.revenues || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
            const totalExpenses = (accountantFinance.expenses || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
            const netBalance = totalRevenues - totalExpenses;

            // Expenses by Category
            const catMap = {};
            (accountantFinance.expenses || []).forEach(e => {
                const cat = e.category || 'أخرى';
                catMap[cat] = (catMap[cat] || 0) + (Number(e.amount) || 0);
            });

            // Students Summary
            let totalExpected = 0, totalPaid = 0, totalDebt = 0;
            const studentRows = [];
            accountantStudents.forEach(s => {
                const tuition = (s.finance?.tuition !== undefined && s.finance.tuition !== '') ? Number(s.finance.tuition) : (Number(accountantFinance.defaults[s.classId]) || 0);
                const transportTotal = Object.values(s.finance?.transportHistory || {}).reduce((sum, t) => sum + (Number(t.amount || 0) - Number(t.discount || 0)), 0);
                const discount = Number(s.finance?.discount) || 0;
                const netReq = (tuition + transportTotal) - discount;
                const paid = (accountantFinance.revenues || []).filter(r => String(r.studentUid) === String(s.uid)).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
                const debt = netReq - paid;
                totalExpected += netReq;
                totalPaid += paid;
                totalDebt += Math.max(0, debt);
                studentRows.push({ name: s.name, className: getClassName(s.classId), netReq, paid, debt });
            });

            // Staff Salary Summary
            let totalSalaries = 0;
            accountantStaff.forEach(u => {
                const net = (Number(u.payroll?.base) || 0) + (Number(u.payroll?.allowance) || 0) - (Number(u.payroll?.deduction) || 0);
                totalSalaries += net;
            });

            const printWin = window.open('', '_blank');
            if (!printWin) return alert('يرجى السماح بالنوافذ المنبثقة');

            printWin.document.write(`
<!DOCTYPE html>
<html dir="rtl">
<head>
    <title>كشف الجرد السنوي - ${academicYear}</title>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Cairo', sans-serif; background: #fff; color: #1e293b; padding: 20px; font-size: 12px; }
        
        .no-print { background: #1e293b; color: #fff; padding: 12px; text-align: center; position: sticky; top: 0; z-index: 100; margin-bottom: 20px; }
        .no-print button { background: #1d4ed8; color: white; border: none; padding: 8px 30px; font-family: 'Cairo'; font-weight: 800; cursor: pointer; border-radius: 6px; font-size: 1rem; }

        /* Header */
        .report-header { text-align: center; border-bottom: 4px double #1e3a8a; padding-bottom: 15px; margin-bottom: 20px; }
        .report-header h1 { font-size: 1.5rem; font-weight: 900; color: #1e3a8a; }
        .report-header .subtitle { font-size: 1rem; font-weight: 700; color: #475569; margin-top: 4px; }
        .report-header .meta { display: flex; justify-content: center; gap: 30px; margin-top: 10px; font-size: 0.85rem; color: #64748b; font-weight: 600; }

        /* Section Title */
        .section-title { background: #1e3a8a; color: #fff; padding: 8px 15px; font-weight: 900; font-size: 0.95rem; border-radius: 6px 6px 0 0; margin-top: 20px; display: flex; align-items: center; gap: 8px; }

        /* Summary Cards */
        .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
        .sum-card { border: 1.5px solid #e2e8f0; padding: 12px; border-radius: 10px; text-align: center; }
        .sum-card small { display: block; font-size: 0.7rem; color: #64748b; font-weight: 700; margin-bottom: 5px; text-transform: uppercase; }
        .sum-card b { font-size: 1.1rem; font-weight: 900; }
        .sum-card.green { background: #f0fdf4; border-color: #bbf7d0; }
        .sum-card.green b { color: #059669; }
        .sum-card.red { background: #fff1f2; border-color: #fecdd3; }
        .sum-card.red b { color: #dc2626; }
        .sum-card.blue { background: #eff6ff; border-color: #bfdbfe; }
        .sum-card.blue b { color: #1d4ed8; }
        .sum-card.amber { background: #fffbeb; border-color: #fde68a; }
        .sum-card.amber b { color: #d97706; }
        .sum-card.navy { background: #1e3a8a; border-color: #1e3a8a; }
        .sum-card.navy small { color: #93c5fd; }
        .sum-card.navy b { color: #fff; }

        /* Tables */
        table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
        th { background: #1e3a8a; color: #fff; padding: 8px 10px; text-align: right; font-weight: 800; border: 1px solid #1e3a8a; }
        td { border: 1px solid #cbd5e1; padding: 7px 10px; }
        tr:nth-child(even) td { background: #f8fafc; }
        .total-row td { background: #e0e7ff !important; font-weight: 900; color: #1e293b; }

        /* Status badges */
        .badge-paid { background: #dcfce7; color: #059669; padding: 2px 8px; border-radius: 20px; font-weight: 800; font-size: 0.75rem; }
        .badge-debt { background: #fee2e2; color: #dc2626; padding: 2px 8px; border-radius: 20px; font-weight: 800; font-size: 0.75rem; }

        /* Signatures */
        .signatures { display: flex; justify-content: space-between; margin-top: 50px; padding-top: 20px; border-top: 2px solid #1e3a8a; }
        .sig-box { text-align: center; width: 200px; }
        .sig-line { border-top: 1.5px solid #334155; margin-top: 40px; padding-top: 5px; font-size: 0.75rem; color: #64748b; }

        .system-note { text-align: center; margin-top: 30px; font-size: 0.7rem; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 10px; }

        @media print {
            body { padding: 10mm; }
            .no-print { display: none !important; }
            @page { size: A4; margin: 10mm; }
        }
    </style>
</head>
<body>
    <div class="no-print">
        <button onclick="window.print()">🖨️ طباعة كشف الجرد السنوي الآن</button>
    </div>

    <!-- Header -->
    <div class="report-header">
        <h1>${branch.name}</h1>
        <div class="subtitle">كشف الجرد المالي السنوي الشامل — العام الدراسي ${academicYear}</div>
        <div class="meta">
            <span>📅 تاريخ الاستخراج: ${new Date().toLocaleDateString('ar-IQ')}</span>
            <span>⏰ الوقت: ${new Date().toLocaleTimeString('ar-IQ')}</span>
            <span>👤 المحاسب: ${currentUser?.name || 'المحاسب المختص'}</span>
        </div>
    </div>

    <!-- Section 1: Financial Summary -->
    <div class="section-title"><span>📊</span> أولاً: الملخص المالي العام</div>
    <div class="summary-grid" style="margin-top:10px;">
        <div class="sum-card green">
            <small>إجمالي الإيرادات المُحصَّلة</small>
            <b>${totalRevenues.toLocaleString('en-US')} د.ع</b>
        </div>
        <div class="sum-card red">
            <small>إجمالي المصروفات الكلية</small>
            <b>${totalExpenses.toLocaleString('en-US')} د.ع</b>
        </div>
        <div class="sum-card amber">
            <small>إجمالي الذمم غير المسددة</small>
            <b>${totalDebt.toLocaleString('en-US')} د.ع</b>
        </div>
        <div class="sum-card navy">
            <small>صافي الفائض / العجز</small>
            <b>${netBalance.toLocaleString('en-US')} د.ع</b>
        </div>
        <div class="sum-card blue">
            <small>المبلغ المطالب به (الكلي)</small>
            <b>${totalExpected.toLocaleString('en-US')} د.ع</b>
        </div>
        <div class="sum-card green">
            <small>ما تم تحصيله من الطلاب</small>
            <b>${totalPaid.toLocaleString('en-US')} د.ع</b>
        </div>
        <div class="sum-card blue">
            <small>إجمالي الرواتب الشهرية</small>
            <b>${totalSalaries.toLocaleString('en-US')} د.ع</b>
        </div>
        <div class="sum-card blue">
            <small>نسبة التحصيل</small>
            <b>${totalExpected > 0 ? ((totalPaid / totalExpected) * 100).toFixed(1) : 0}%</b>
        </div>
    </div>

    <!-- Section 2: Expenses by Category -->
    <div class="section-title"><span>💸</span> ثانياً: تفصيل المصروفات حسب الأبواب</div>
    <table style="margin-top:8px;">
        <thead>
            <tr>
                <th style="width:40px;">ت</th>
                <th>باب الصرف</th>
                <th style="text-align:center;">المبلغ الإجمالي (د.ع)</th>
                <th style="text-align:center;">النسبة من الكلي</th>
            </tr>
        </thead>
        <tbody>
            ${Object.entries(catMap).sort((a,b) => b[1]-a[1]).map(([cat, amt], i) => `
            <tr>
                <td style="text-align:center;">${i+1}</td>
                <td style="font-weight:700;">${cat}</td>
                <td style="text-align:center; font-weight:800; color:#c62828;">${amt.toLocaleString('en-US')}</td>
                <td style="text-align:center;">${totalExpenses > 0 ? ((amt/totalExpenses)*100).toFixed(1) : 0}%</td>
            </tr>`).join('')}
            <tr class="total-row">
                <td colspan="2" style="text-align:left; padding-right:20px;">الإجمالي الكلي للمصروفات</td>
                <td style="text-align:center;">${totalExpenses.toLocaleString('en-US')}</td>
                <td style="text-align:center;">100%</td>
            </tr>
        </tbody>
    </table>

    <!-- Section 3: Staff Payroll -->
    <div class="section-title" style="margin-top:20px;"><span>👥</span> ثالثاً: كشف الرواتب والموارد البشرية</div>
    <table style="margin-top:8px;">
        <thead>
            <tr>
                <th style="width:40px;">ت</th>
                <th>اسم الموظف</th>
                <th style="text-align:center;">المنصب</th>
                <th style="text-align:center;">الراتب الأساسي</th>
                <th style="text-align:center;">المخصصات</th>
                <th style="text-align:center;">الاستقطاعات</th>
                <th style="text-align:center;">الصافي الشهري</th>
            </tr>
        </thead>
        <tbody>
            ${accountantStaff.map((u, i) => {
                const b = Number(u.payroll?.base)||0, a = Number(u.payroll?.allowance)||0, d = Number(u.payroll?.deduction)||0;
                const net = (b+a)-d;
                const role = u.role === 'teacher' ? 'مدرس' : u.role === 'admin' ? 'مدير' : u.role === 'accountant' ? 'محاسب' : 'إداري';
                return `<tr>
                    <td style="text-align:center;">${i+1}</td>
                    <td style="font-weight:700;">${u.name}</td>
                    <td style="text-align:center;">${role}</td>
                    <td style="text-align:center;">${b.toLocaleString('en-US')}</td>
                    <td style="text-align:center; color:#2563eb;">+${a.toLocaleString('en-US')}</td>
                    <td style="text-align:center; color:#dc2626;">-${d.toLocaleString('en-US')}</td>
                    <td style="text-align:center; font-weight:900; color:#1e3a8a;">${net.toLocaleString('en-US')}</td>
                </tr>`;
            }).join('')}
            <tr class="total-row">
                <td colspan="6" style="text-align:left; padding-right:20px;">إجمالي الرواتب الشهرية للكادر</td>
                <td style="text-align:center;">${totalSalaries.toLocaleString('en-US')}</td>
            </tr>
        </tbody>
    </table>

    <!-- Section 4: Student Debts -->
    <div class="section-title" style="margin-top:20px;"><span>🎓</span> رابعاً: كشف الذمم المالية للطلبة</div>
    <table style="margin-top:8px;">
        <thead>
            <tr>
                <th style="width:40px;">ت</th>
                <th>اسم الطالب</th>
                <th>الصف / الشعبة</th>
                <th style="text-align:center;">الإجمالي المطلوب</th>
                <th style="text-align:center;">المسدَّد</th>
                <th style="text-align:center;">المتبقي</th>
                <th style="text-align:center;">الحالة</th>
            </tr>
        </thead>
        <tbody>
            ${studentRows.sort((a,b) => b.debt - a.debt).map((s, i) => `
            <tr>
                <td style="text-align:center;">${i+1}</td>
                <td style="font-weight:700;">${s.name}</td>
                <td style="font-size:0.78rem; color:#64748b;">${s.className}</td>
                <td style="text-align:center; font-weight:700;">${s.netReq.toLocaleString('en-US')}</td>
                <td style="text-align:center; color:#059669; font-weight:700;">${s.paid.toLocaleString('en-US')}</td>
                <td style="text-align:center; color:${s.debt > 0 ? '#dc2626' : '#059669'}; font-weight:900;">${Math.max(0,s.debt).toLocaleString('en-US')}</td>
                <td style="text-align:center;"><span class="${s.debt <= 0 ? 'badge-paid' : 'badge-debt'}">${s.debt <= 0 ? '✅ مسدد بالكامل' : '⚠️ متبقي غير مسدد'}</span></td>
            </tr>`).join('')}
            <tr class="total-row">
                <td colspan="3" style="text-align:left; padding-right:20px;">الإجمالي الكلي</td>
                <td style="text-align:center;">${totalExpected.toLocaleString('en-US')}</td>
                <td style="text-align:center;">${totalPaid.toLocaleString('en-US')}</td>
                <td style="text-align:center;">${totalDebt.toLocaleString('en-US')}</td>
                <td></td>
            </tr>
        </tbody>
    </table>

    <!-- Signatures -->
    <div class="signatures">
        <div class="sig-box"><b>المحاسب المختص</b><div class="sig-line">التوقيع والختم</div></div>
        <div class="sig-box"><b>مراقب الحسابات</b><div class="sig-line">التوقيع والختم</div></div>
        <div class="sig-box"><b>مدير الفرع</b><div class="sig-line">التوقيع والختم</div></div>
    </div>

    <p class="system-note">تم توليد هذا الكشف آلياً بواسطة نظام إدارة مدرسة النهرين — العام الدراسي ${academicYear} — جميع الأرقام مستخرجة من قاعدة البيانات الحية</p>
</body>
</html>`);
            printWin.document.close();
            setTimeout(() => { if (printWin && !printWin.closed) printWin.print(); }, 800);
        };

        window.printPeriodicReport = function(range) {

            const userBranchId = currentUser ? currentUser.branchId : 'samawah';
            const branch = (window.NAHRAIN_BRANCHES && window.NAHRAIN_BRANCHES[userBranchId]) ? window.NAHRAIN_BRANCHES[userBranchId] : { name: 'مؤسسة النهرين التعليمية', logo: 'logo.jpg' };
            const now = new Date();
            let startTime = 0;
            let title = '';

            if (range === 'day') {
                startTime = new Date().setHours(0,0,0,0);
                title = 'كشف حركة الصندوق اليومي';
            } else if (range === 'week') {
                startTime = Date.now() - (7 * 24 * 60 * 60 * 1000);
                title = 'كشف حركة الصندوق الأسبوعي';
            } else if (range === 'month') {
                startTime = Date.now() - (30 * 24 * 60 * 60 * 1000);
                title = 'كشف حركة الصندوق الشهري';
            }

            const revs = accountantFinance.revenues.filter(r => r.timestamp >= startTime);
            const exps = accountantFinance.expenses.filter(e => e.timestamp >= startTime);
            const totalIn = revs.reduce((sum, r) => sum + (Number(r.amount)||0), 0);
            const totalOut = exps.reduce((sum, e) => sum + (Number(e.amount)||0), 0);

            const win = window.open('', '_blank');
            if (!win) return alert("يرجى السماح بالنوافذ المنبثقة");

            let html = `
                <html dir="rtl">
                <head>
                    <title>${title}</title>
                    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
                    <style>
                        body { font-family: 'Cairo', sans-serif; padding: 0; margin: 0; background: white; color: #1e293b; }
                        @media print {
                            body { padding: 10mm; }
                            .no-print { display: none; }
                        }
                        .report-container { max-width: 900px; margin: 0 auto; padding: 20px; }
                        
                        /* Formal Header */
                        .formal-header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 20px; margin-bottom: 30px; }
                        .formal-header h1 { margin: 0; font-size: 1.8rem; font-weight: 900; color: #000; }
                        .formal-header p { margin: 5px 0; font-size: 1.1rem; font-weight: 700; }
                        
                        .info-strip { display: flex; justify-content: space-between; margin-bottom: 30px; font-weight: bold; border-bottom: 1px solid #ccc; padding-bottom: 10px; }

                        /* Summary Table */
                        .summary-table { width: 100%; border-collapse: collapse; margin-bottom: 40px; border: 2px solid #000; }
                        .summary-table td { padding: 15px; text-align: center; border: 1px solid #000; width: 33.33%; }
                        .summary-table label { display: block; font-size: 0.9rem; color: #475569; margin-bottom: 5px; }
                        .summary-table span { font-size: 1.4rem; font-weight: 900; }
                        
                        /* Main Transactions Table */
                        .data-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                        .data-table th { background: #f1f5f9; color: #000; border: 1px solid #000; padding: 12px; text-align: right; font-weight: 900; }
                        .data-table td { border: 1px solid #000; padding: 10px 12px; font-size: 0.95rem; }
                        .type-in { color: #059669; font-weight: bold; }
                        .type-out { color: #dc2626; font-weight: bold; }
                        
                        /* Formal Footer */
                        .formal-footer { margin-top: 60px; display: flex; justify-content: space-between; }
                        .sign-area { text-align: center; width: 250px; }
                        .sign-line { margin-top: 50px; border-top: 1px solid #000; }
                        .system-note { text-align: center; font-size: 0.8rem; color: #666; margin-top: 50px; border-top: 1px solid #eee; padding-top: 10px; }
                    </style>
                </head>
                <body onload="window.print()">
                    <div class="report-container">
                        <div class="formal-header">
                            <h1>${branch.name}</h1>
                            <p>${title}</p>
                        </div>

                        <div class="info-strip">
                            <div>تاريخ التقرير: ${new Date().toLocaleDateString('ar-IQ')}</div>
                            <div>وقت الاستخراج: ${new Date().toLocaleTimeString('ar-IQ')}</div>
                        </div>

                        <table class="summary-table">
                            <tr>
                                <td><label>إجمالي المقبوضات</label><span style="color:#059669;">${totalIn.toLocaleString()} د.ع</span></td>
                                <td><label>إجمالي المصروفات</label><span style="color:#dc2626;">${totalOut.toLocaleString()} د.ع</span></td>
                                <td><label>صافي الصندوق</label><span style="color:#1e3a8a;">${(totalIn - totalOut).toLocaleString()} د.ع</span></td>
                            </tr>
                        </table>
                        
                        <h3 style="border-right: 4px solid #000; padding-right: 10px; margin-bottom: 15px;">السجل التفصيلي للحركات المالية</h3>
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th style="width:25%">التاريخ والوقت</th>
                                    <th style="width:12%">النوع</th>
                                    <th style="width:40%">البيان / تفاصيل العملية</th>
                                    <th style="width:23%">المبلغ (د.ع)</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${[...revs.map(r => ({...r, type: 'in'})), ...exps.map(e => ({...e, type: 'out'}))]
                                    .sort((a,b) => b.timestamp - a.timestamp)
                                    .map(t => `
                                        <tr>
                                            <td>${new Date(t.timestamp).toLocaleString('ar-IQ')}</td>
                                            <td class="${t.type === 'in' ? 'type-in' : 'type-out'}">${t.type === 'in' ? 'مقبوضات' : 'مصروفات'}</td>
                                            <td style="font-weight:600;">${t.note || '-'}</td>
                                            <td style="font-weight:900; text-align:left;">${Number(t.amount).toLocaleString()}</td>
                                        </tr>
                                    `).join('')}
                                ${revs.length === 0 && exps.length === 0 ? '<tr><td colspan="4" style="text-align:center; padding:50px;">لا توجد بيانات مسجلة لهذه الفترة</td></tr>' : ''}
                            </tbody>
                        </table>

                        <div class="formal-footer">
                            <div class="sign-area">
                                <p>توقيع وختم المحاسب</p>
                                <div class="sign-line"></div>
                            </div>
                            <div class="sign-area">
                                <p>توقيع مدير الفرع</p>
                                <div class="sign-line"></div>
                            </div>
                        </div>

                        <p class="system-note">تم توليد هذا الكشف آلياً بواسطة نظام إدارة مدرسة النهرين - جميع الحقوق محفوظة</p>
                    </div>
                </body>
                </html>
            `;
            win.document.write(html);
            win.document.close();
        };

        function _buildAccSectionMap() {
            const map = {};
            if (window.schoolStructure) {
                window.schoolStructure.forEach((dept, dIdx) => {
                    const stages = Array.isArray(dept.stages) ? dept.stages : Object.values(dept.stages || {});
                    stages.forEach((st, stIdx) => {
                        const sections = Array.isArray(st.sections) ? st.sections : Object.values(st.sections || {});
                        sections.forEach(sc => {
                            if (sc.id) map[sc.id] = { deptIdx: dIdx, stageIdx: stIdx };
                        });
                    });
                });
            }
            return map;
        }

        function onAccDeptChange() {
            const deptEl = document.getElementById('acc-filter-dept');
            const stageEl = document.getElementById('acc-filter-stage');
            const sectionEl = document.getElementById('acc-filter-section');
            if (!deptEl || !stageEl || !sectionEl) return;

            const dIdx = deptEl.value;
            stageEl.innerHTML = '<option value="all">📖 جميع المراحل</option>';
            sectionEl.innerHTML = '<option value="all">🏫 جميع الشعب</option>';

            if (dIdx !== 'all' && window.schoolStructure) {
                const dept = window.schoolStructure[dIdx];
                if (dept) {
                    const stages = Array.isArray(dept.stages) ? dept.stages : Object.values(dept.stages || {});
                    stages.forEach((st, stIdx) => {
                        stageEl.innerHTML += `<option value="${stIdx}" style="background:#1e293b;color:#fff;">${st.name}</option>`;
                    });
                }
            }
            filterAccStudents();
        }

        function onAccStageChange() {
            const deptEl = document.getElementById('acc-filter-dept');
            const stageEl = document.getElementById('acc-filter-stage');
            const sectionEl = document.getElementById('acc-filter-section');
            if (!deptEl || !stageEl || !sectionEl) return;

            const dIdx = deptEl.value;
            const stIdx = stageEl.value;
            sectionEl.innerHTML = '<option value="all">🏫 جميع الشعب</option>';

            if (dIdx !== 'all' && stIdx !== 'all' && window.schoolStructure) {
                const dept = window.schoolStructure[dIdx];
                if (dept) {
                    const stages = Array.isArray(dept.stages) ? dept.stages : Object.values(dept.stages || {});
                    const stage = stages[stIdx];
                    if (stage) {
                        const sections = Array.isArray(stage.sections) ? stage.sections : Object.values(stage.sections || {});
                        sections.forEach(sc => {
                            if (sc.id) sectionEl.innerHTML += `<option value="${sc.id}" style="background:#1e293b;color:#fff;">${sc.name}</option>`;
                        });
                    }
                }
            }
            filterAccStudents();
        }

        function filterAccStudents() {
            const searchInput = document.getElementById('acc-search-student');
            const deptEl = document.getElementById('acc-filter-dept');
            const stageEl = document.getElementById('acc-filter-stage');
            const sectionEl = document.getElementById('acc-filter-section');
            const sortSel = document.getElementById('acc-sort-students');

            const q = searchInput ? searchInput.value.toLowerCase() : '';
            const filterDept    = deptEl    ? deptEl.value    : 'all';
            const filterStage   = stageEl   ? stageEl.value   : 'all';
            const filterSection = sectionEl ? sectionEl.value : 'all';
            const sortMode = sortSel ? sortSel.value : 'name';

            const sectionMap = _buildAccSectionMap();

            // Cards mode
            const cards = document.querySelectorAll('#acc-students-cards .acc-row');
            cards.forEach(card => {
                const name = (card.getAttribute('data-name') || '').toLowerCase();
                const classId = card.getAttribute('data-class-id') || '';
                const textMatches = name.includes(q);

                let classMatches = false;
                if (filterSection !== 'all') {
                    classMatches = (classId === filterSection);
                } else if (filterDept === 'all' && filterStage === 'all') {
                    classMatches = true;
                } else {
                    const info = sectionMap[classId];
                    if (info) {
                        const deptOk  = filterDept  === 'all' || String(info.deptIdx)  === filterDept;
                        const stageOk = filterStage === 'all' || String(info.stageIdx) === filterStage;
                        classMatches = deptOk && stageOk;
                    }
                }

                card.style.display = (textMatches && classMatches) ? 'flex' : 'none';
            });

            // If sort changed — re-render
            if (sortMode && sortMode !== 'name') {
                renderAccountantUI();
            }
        }

        function printAccDebtorsReport() {
            const data = [];
            accountantStudents.forEach(s => {
                const tuition = (s.finance && s.finance.tuition !== undefined && s.finance.tuition !== '')
                    ? Number(s.finance.tuition)
                    : (Number(accountantFinance.defaults[s.classId]) || 0);
                const transport = Object.values(s.finance?.transportHistory || {}).reduce((sum, t) => sum + (Number(t.amount || 0) - Number(t.discount || 0)), 0);
                const discount = Number(s.finance?.discount) || 0;
                const netRequired = (tuition + transport) - discount;
                const paid = accountantFinance.revenues
                    .filter(r => String(r.studentUid) === String(s.uid))
                    .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
                const remaining = netRequired - paid;
                if (remaining > 0) {
                    data.push({ name: s.name, className: getClassName(s.classId), paid, remaining, netRequired });
                }
            });

            data.sort((a, b) => b.remaining - a.remaining);

            const printWindow = window.open('', '_blank');
            if (!printWindow) return showCustomAlert('تنبيه', 'يرجى السماح بالنوافذ المنبثقة لطباعة التقرير', 'warning');

            const totalDebt = data.reduce((s, r) => s + r.remaining, 0);
            const branchId = currentUser?.branchId || '';
            const branch = (window.NAHRAIN_BRANCHES && window.NAHRAIN_BRANCHES[branchId]) ? window.NAHRAIN_BRANCHES[branchId].name : branchId;

            const html = `<html dir="rtl"><head>
                <title>كشف المتلكئين</title>
                <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap" rel="stylesheet">
                <style>
                    body { font-family: 'Cairo', sans-serif; padding: 20px; color:#1e293b; }
                    h2 { text-align:center; color:#c62828; margin-bottom:4px; }
                    .meta { text-align:center; color:#64748b; font-size:0.85rem; margin-bottom:16px; }
                    table { width:100%; border-collapse:collapse; font-size:0.9rem; }
                    th { background:#1e3a8a; color:#fff; padding:10px; text-align:center; }
                    td { border:1px solid #e2e8f0; padding:9px 12px; text-align:center; }
                    tr:nth-child(even) td { background:#f8fafc; }
                    .total-row td { background:#fef2f2; font-weight:900; color:#c62828; border-top:3px solid #c62828; }
                    @media print { button { display:none; } }
                </style></head>
                <body>
                <button onclick="window.print()" style="display:block; margin:0 auto 16px; padding:8px 24px; background:#1e3a8a; color:#fff; border:none; border-radius:8px; cursor:pointer; font-family:Cairo,sans-serif; font-size:1rem;">طباعة</button>
                <h2>كشف الطلاب المتلكئين</h2>
                <p class="meta">فرع: ${branch} | تاريخ الإصدار: ${new Date().toLocaleDateString('ar-IQ')} | العدد: ${data.length} طالب</p>
                <table>
                    <thead><tr><th>#</th><th>اسم الطالب</th><th>الشعبة</th><th>إجمالي المطلوب</th><th>المسدّد</th><th>المتبقي</th></tr></thead>
                    <tbody>
                        ${data.map((s, i) => `<tr>
                            <td>${i + 1}</td>
                            <td style="text-align:right; font-weight:700;">${s.name}</td>
                            <td>${s.className}</td>
                            <td>${s.netRequired.toLocaleString()} د.ع</td>
                            <td style="color:#166534;">${s.paid.toLocaleString()} د.ع</td>
                            <td style="color:#c62828; font-weight:900;">${s.remaining.toLocaleString()} د.ع</td>
                        </tr>`).join('')}
                        <tr class="total-row">
                            <td colspan="5" style="text-align:left;">إجمالي الديون المستحقة</td>
                            <td>${totalDebt.toLocaleString()} د.ع</td>
                        </tr>
                    </tbody>
                </table>
                </body></html>`;

            printWindow.document.write(html);
            printWindow.document.close();
            setTimeout(() => { if (printWindow && !printWindow.closed) printWindow.print(); }, 600);
        }

        function filterAccHR() {
            let q = document.getElementById('acc-search-hr').value.toLowerCase();
            let rows = document.querySelectorAll('#acc-hr-table tbody tr');
            rows.forEach(r => { r.style.display = r.innerText.toLowerCase().includes(q) ? '' : 'none'; });
        }

        // addAccTransaction is defined as window.addAccTransaction below (line ~2985)

        // submitAccStudentPayment is defined as window.submitAccStudentPayment below (line ~3080)



        function arabicNumberToWords(num) {
            const ones = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
            const tens = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
            const hundreds = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];
            function convert(n) {
                if (n < 20) return ones[n];
                if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 !== 0 ? ' و' + ones[n % 10] : '');
                if (n < 1000) return hundreds[Math.floor(n / 100)] + (n % 100 !== 0 ? ' و' + convert(n % 100) : '');
                if (n < 1000000) { let k = Math.floor(n/1000); let r = n%1000; return (k===1?'ألف':(k===2?'ألفان':(k<=10?ones[k]+' آلاف':convert(k)+' ألف'))) + (r!==0?' و'+convert(r):''); }
                return n.toString();
            }
            return convert(num) + ' دينار عراقي لا غير';
        }

        window.printAccReceipt = function(id, type, amount, note, dateStr, category, studentUid = '', nextDueDateOverride = '', payee = '', method = '', refNum = '') {
            const amountWords = arabicNumberToWords(amount);
            const userBranchId = currentUser ? currentUser.branchId : 'samawah';
            const branch = (window.NAHRAIN_BRANCHES && window.NAHRAIN_BRANCHES[userBranchId]) ? window.NAHRAIN_BRANCHES[userBranchId] : (window.NAHRAIN_BRANCHES ? window.NAHRAIN_BRANCHES['samawah'] : { name: 'مؤسسة النهرين التعليمية', logo: 'logo.jpg' });
            // مسار مطلق للصور (يعمل في نوافذ about:blank)
            const baseUrl = window.location.href.replace(/\/[^\/]*$/, '/');
            const logoUrl = baseUrl + (branch.logo || 'logo.jpg');
            const txList = type === 'revenue' ? (accountantFinance.revenues || []) : (accountantFinance.expenses || []);
            const txRecord = txList.find(t => String(t.id) === String(id));
            const displayNum = txRecord?.receiptNum || '#' + id.substring(0, 8).toUpperCase();
            
            let studentName = '................................';
            let studentClass = '....................';
            let netTuition = 0;
            let totalPaid = 0;
            let remaining = 0;
            let nextDueDate = nextDueDateOverride || '---';
            let lastPaymentDate = '---';
            let loginCode = '';
            let studentPassword = '';

            if (studentUid) {
                const s = accountantStudents.find(x => String(x.uid) === String(studentUid));
                if (s) {
                    studentName = s.name;
                    studentClass = getClassName(s.classId);
                    const tuition = (s.finance && s.finance.tuition !== undefined && s.finance.tuition !== "") ? Number(s.finance.tuition) : (Number(accountantFinance.defaults[s.classId]) || 0);
                    const transport = Number(s.finance?.transportFee) || 0;
                    const discount = Number(s.finance?.discount) || 0;
                    netTuition = (tuition + transport) - discount;
                    
                    const myRevs = accountantFinance.revenues.filter(r => r.studentUid === studentUid);
                    totalPaid = myRevs.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
                    // إذا الدفعة الحالية ما زالت غير محفوظة في الكاش المحلي، أضفها يدوياً
                    const alreadyInCache = myRevs.some(r => String(r.id) === String(id));
                    if (!alreadyInCache) totalPaid += Number(amount) || 0;
                    remaining = netTuition - totalPaid;
                    
                    if (myRevs.length > 0) {
                        const latest = [...myRevs].sort((a,b) => b.timestamp - a.timestamp)[0];
                        lastPaymentDate = new Date(latest.timestamp).toLocaleDateString('ar-IQ');
                    }
                    if (!nextDueDateOverride) nextDueDate = s.finance?.nextDueDate || '---';
                    loginCode = s.loginCode || '';
                    studentPassword = s.password || '';
                }
            }

            const printWindow = window.open('', '_blank');
            if (!printWindow) return showCustomAlert('تنبيه', 'يرجى السماح بالنوافذ المنبثقة لطباعة الوصل', 'warning');
            const typeLabel = type === 'revenue' ? 'وصل قبض' : 'سند صرف';
            const headerColor = type === 'revenue' ? '#059669' : '#c62828';
            const titleBg = type === 'revenue' ? '#f0fdf4' : '#ffebee';
            let html = '';

            if (type === 'expense') {
                html = `
                <!DOCTYPE html>
                <html dir="rtl">
                <head>
                    <title>سند صرف - ${id}</title>
                    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
                    <style>
                        body { font-family: 'Cairo', sans-serif; background: #f1f5f9; padding: 0; margin: 0; }
                        .voucher-page { 
                            background: white; 
                            width: 210mm; 
                            height: 148mm; 
                            margin: 20px auto; 
                            padding: 30px 50px; 
                            box-sizing: border-box; 
                            position: relative;
                            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
                            border-radius: 12px;
                            overflow: hidden;
                        }
                        .voucher-page::before {
                            content: "";
                            position: absolute;
                            top: 0; left: 0; right: 0;
                            height: 8px;
                            background: #c62828;
                        }
                        .header { display: flex; justify-content: space-between; border-bottom: 2px solid #f1f5f9; padding-bottom: 15px; margin-bottom: 20px; }
                        .header-right h1 { margin: 0; font-size: 1.5rem; color: #1e293b; font-weight: 900; }
                        .header-right p { margin: 0; color: #64748b; font-size: 0.85rem; font-weight: 600; }
                        
                        .header-left { text-align: left; color: #64748b; font-size: 0.85rem; font-weight: 600; }
                        .header-left b { color: #1e293b; }

                        .doc-title-container { text-align: center; margin-bottom: 25px; }
                        .doc-title { 
                            display: inline-block; 
                            padding: 8px 60px; 
                            border: 2px solid #c62828; 
                            font-size: 1.5rem; 
                            font-weight: 900; 
                            background: #fff5f5; 
                            color: #c62828;
                            border-radius: 12px;
                        }

                        .voucher-meta { 
                            display: grid; 
                            grid-template-columns: 1fr 1fr 1fr; 
                            gap: 15px; 
                            margin-bottom: 25px; 
                            background: #f8fafc; 
                            padding: 15px; 
                            border-radius: 10px; 
                        }
                        .meta-item { display: flex; flex-direction: column; gap: 4px; }
                        .meta-label { font-size: 0.75rem; color: #64748b; font-weight: 700; }
                        .meta-val { font-size: 1rem; color: #1e293b; font-weight: 800; }

                        .content-body { margin-bottom: 30px; font-size: 1.1rem; line-height: 2; }
                        .row-item { margin-bottom: 15px; border-bottom: 1px dashed #e2e8f0; padding-bottom: 5px; }
                        .label { font-weight: bold; color: #475569; margin-left: 10px; }
                        .val { font-weight: 800; color: #1e293b; }

                        .amount-section { 
                            border: 2px solid #c62828; 
                            padding: 20px; 
                            border-radius: 12px;
                            background: #fff;
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                        }
                        .amount-info { flex: 1; }
                        .amount-numeric { font-size: 1.8rem; font-weight: 900; color: #c62828; margin-bottom: 5px; }
                        .amount-literal { font-size: 1rem; color: #475569; font-weight: 600; }

                        .footer-sigs { display: flex; justify-content: space-between; margin-top: auto; padding-top: 30px; }
                        .sig { width: 28%; text-align: center; font-weight: 800; color: #475569; font-size: 0.9rem; }
                        .sig-line { border-top: 2px solid #e2e8f0; margin-top: 40px; }

                        .watermark {
                            position: absolute;
                            top: 50%;
                            left: 50%;
                            transform: translate(-50%, -50%) rotate(-25deg);
                            font-size: 7rem;
                            font-weight: 900;
                            color: rgba(198, 40, 40, 0.04);
                            pointer-events: none;
                            z-index: 0;
                        }

                        .no-print-bar { background: #1e293b; color: white; padding: 15px; text-align: center; position: sticky; top: 0; z-index: 100; }
                        .no-print-bar button { background: #c62828; color: white; border: none; padding: 10px 40px; font-family: 'Cairo'; font-weight: 800; cursor: pointer; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.2); }

                        @media print {
                            body { background: white; }
                            .voucher-page { margin: 0; border: none; width: 100%; height: 100%; box-shadow: none; border-radius: 0; }
                            .no-print-bar { display: none !important; }
                        }
                    </style>
                </head>
                <body>
                    <div class="no-print-bar no-print">
                        <button onclick="window.print()">🖨️ طباعة سند الصرف الآن</button>
                    </div>
                    <div class="voucher-page">
                        <div class="watermark">تم الصرف</div>
                        <div class="header">
                            <div class="header-right">
                                <h1>مؤسسة النهرين التعليمية الدولية</h1>
                                <p>قسم الشؤون المالية والحسابات - فرع ${branch.name.split(' ').pop()}</p>
                            </div>
                            <div class="header-left">
                                <div>رقم السند: <b contenteditable="true">${displayNum}</b></div>
                                <div>التاريخ: <b contenteditable="true">${dateStr}</b></div>
                            </div>
                        </div>

                        <div class="doc-title-container">
                            <div class="doc-title">سند صـــــرف مالي</div>
                        </div>

                        <div class="voucher-meta">
                            <div class="meta-item">
                                <span class="meta-label">طريقة الدفع</span>
                                <span class="meta-val" contenteditable="true">${method || 'نقداً'}</span>
                            </div>
                            <div class="meta-item">
                                <span class="meta-label">باب الصرف</span>
                                <span class="meta-val" contenteditable="true">${category || 'أخرى'}</span>
                            </div>
                            <div class="meta-item">
                                <span class="meta-label">رقم المرجع/الشيك</span>
                                <span class="meta-val" contenteditable="true">${refNum || '---'}</span>
                            </div>
                        </div>

                        <div class="content-body">
                            <div class="row-item">
                                <span class="label">صرف للسيد:</span>
                                <span class="val" contenteditable="true">${payee || (note.includes('راتب') ? note : '................................................')}</span>
                            </div>
                            <div class="row-item">
                                <span class="label">وذلك عـن (البيان):</span>
                                <span class="val" contenteditable="true">${note}</span>
                            </div>
                        </div>

                        <div class="amount-section">
                            <div class="amount-info">
                                <div class="amount-numeric">${amount.toLocaleString()} د.ع</div>
                                <div class="amount-literal">المبلغ كتابةً: <span style="color:#c62828; font-weight:800;">${amountWords}</span></div>
                            </div>
                        </div>

                        <div class="footer-sigs">
                            <div class="sig">توقيع المستلم<div class="sig-line"></div></div>
                            <div class="sig">المحاسب المختص<div class="sig-line"></div></div>
                            <div class="sig">المدير العام / المخول<div class="sig-line"></div></div>
                        </div>
                    </div>
                </body>
                </html>
                `;
            } else {
                html = `<!DOCTYPE html>
                <html dir="rtl">
                <head>
                    <meta charset="UTF-8">
                    <title>وصل قبض - ${studentName}</title>
                    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;600;700;900&display=swap" rel="stylesheet">
                    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
                    <style>
                        *{margin:0;padding:0;box-sizing:border-box;}
                        body{font-family:'Cairo',sans-serif;background:#f1f5f9;color:#1e293b;}
                        .page{width:210mm;min-height:297mm;margin:0 auto;background:white;display:flex;flex-direction:column;position:relative;overflow:hidden;}

                        /* HEADER */
                        .rh{background:#1e293b;padding:22px 35px 18px;position:relative;overflow:hidden;display:flex;justify-content:space-between;align-items:center;}
                        .rh::before{content:'';position:absolute;top:-25px;right:-15px;width:130px;height:130px;background:#059669;transform:rotate(45deg);opacity:.75;}
                        .rh::after{content:'';position:absolute;top:-35px;right:75px;width:85px;height:130px;background:#34d399;transform:rotate(45deg);opacity:.4;}
                        .rh-logo{display:flex;align-items:center;gap:12px;z-index:1;position:relative;}
                        .rh-logo img{height:58px;filter:brightness(0) invert(1);}
                        .rh-logo-text h2{font-size:1.1rem;font-weight:900;color:white;margin:0;}
                        .rh-logo-text p{font-size:0.68rem;color:#94a3b8;margin:0;font-weight:600;letter-spacing:1px;}
                        .rh-title{text-align:left;z-index:1;position:relative;}
                        .rh-title h1{font-size:2.2rem;font-weight:900;color:white;letter-spacing:2px;line-height:1;}
                        .rh-title span{font-size:0.75rem;color:#059669;font-weight:700;letter-spacing:2px;}

                        /* CLIENT BAR */
                        .cb{background:#f8fafc;border-bottom:3px solid #059669;padding:15px 35px;display:flex;align-items:center;gap:20px;}
                        .cb-name{flex:1;}
                        .cb-name small{font-size:0.65rem;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:1px;display:block;}
                        .cb-name strong{font-size:1.3rem;font-weight:900;color:#1e293b;}
                        .cb-meta{display:flex;gap:0;}
                        .mi{padding:0 18px;border-right:2px solid #e2e8f0;text-align:center;}
                        .mi:last-child{border-right:none;padding-left:0;}
                        .mi small{font-size:0.63rem;color:#64748b;font-weight:700;letter-spacing:.5px;display:block;}
                        .mi strong{font-size:0.88rem;font-weight:800;color:#1e293b;}
                        .mi.hl strong{color:#059669;}

                        /* BODY */
                        .rb{display:flex;flex:1;padding:20px 0 0;}
                        .sidebar{width:160px;background:#f8fafc;padding:18px 15px 18px 18px;border-left:1px solid #e2e8f0;flex-shrink:0;}
                        .si{margin-bottom:16px;}
                        .si .sl{font-size:0.62rem;color:#059669;font-weight:800;letter-spacing:1px;text-transform:uppercase;display:block;margin-bottom:2px;}
                        .si .sv{font-size:0.8rem;color:#334155;font-weight:600;line-height:1.4;}
                        .mc{flex:1;padding:0 25px 15px 25px;}

                        /* TABLE */
                        .dt{width:100%;border-collapse:collapse;margin-bottom:18px;}
                        .dt thead tr{background:#1e293b;color:white;}
                        .dt thead th{padding:9px 12px;font-size:0.73rem;font-weight:700;letter-spacing:.5px;text-align:right;}
                        .dt thead th:last-child{text-align:left;}
                        .dt tbody tr{border-bottom:1px solid #f1f5f9;}
                        .dt tbody tr:nth-child(even){background:#f8fafc;}
                        .dt tbody td{padding:11px 12px;font-size:0.85rem;color:#334155;}
                        .dt tbody td:last-child{text-align:left;font-weight:700;color:#059669;}
                        .td-desc{font-weight:700;color:#1e293b;}
                        .td-sub{font-size:0.72rem;color:#64748b;}

                        /* SUMMARY */
                        .sa{display:flex;justify-content:flex-end;margin-bottom:16px;}
                        .st{width:250px;}
                        .sr{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:0.85rem;}
                        .sr .sl{color:#64748b;font-weight:600;}
                        .sr .sv{font-weight:700;color:#1e293b;}
                        .sr.total{background:#059669;color:white;padding:9px 12px;border-radius:6px;margin-top:4px;border:none;}
                        .sr.total .sl{color:rgba(255,255,255,.85);font-size:0.88rem;}
                        .sr.total .sv{color:white;font-size:1.05rem;font-weight:900;}

                        /* CREDENTIALS */
                        .cred{background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:10px 15px;margin-bottom:16px;display:flex;gap:20px;align-items:center;flex-wrap:wrap;}
                        .cred-t{font-size:0.72rem;color:#15803d;font-weight:800;letter-spacing:1px;white-space:nowrap;}
                        .cred-p{font-size:0.82rem;}
                        .cred-p span{color:#64748b;font-weight:600;}
                        .cred-p b{color:#166534;direction:ltr;display:inline-block;font-size:0.9rem;}

                        /* SIGS */
                        .sigs{display:flex;justify-content:space-between;padding:10px 35px 20px;}
                        .sb{text-align:center;width:30%;}
                        .sb .sn{font-size:0.8rem;font-weight:800;color:#475569;margin-bottom:38px;}
                        .sb .sl2{border-top:2px solid #e2e8f0;padding-top:5px;}
                        .sb .sl2 span{font-size:0.65rem;color:#94a3b8;}

                        /* FOOTER */
                        .rf{background:#1e293b;padding:12px 35px;display:flex;justify-content:center;gap:35px;align-items:center;margin-top:auto;position:relative;overflow:hidden;}
                        .rf::before{content:'';position:absolute;bottom:-20px;left:-10px;width:100px;height:80px;background:#059669;transform:rotate(45deg);opacity:.6;}
                        .rf::after{content:'';position:absolute;bottom:-30px;left:60px;width:70px;height:80px;background:#34d399;transform:rotate(45deg);opacity:.35;}
                        .fi{display:flex;align-items:center;gap:7px;color:#94a3b8;font-size:0.72rem;z-index:1;}
                        .fi i{color:#059669;font-size:0.85rem;}

                        .wm{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:9rem;font-weight:900;color:rgba(5,150,105,.04);pointer-events:none;white-space:nowrap;z-index:0;}
                        .no-print-bar{background:#1e293b;color:white;padding:11px;text-align:center;position:sticky;top:0;z-index:100;}
                        .no-print-bar button{background:#059669;color:white;border:none;padding:7px 28px;font-family:'Cairo';font-weight:800;cursor:pointer;border-radius:6px;font-size:0.9rem;}

                        @media print{
                            body{background:white!important;}
                            .no-print{display:none!important;}
                            .page{margin:0;width:100%;min-height:100vh;}
                            @page{size:A4 portrait;margin:0;}
                        }
                    </style>
                </head>
                <body>
                <div class="no-print-bar no-print">
                    <button onclick="window.print()">🖨️ طباعة الوصل الآن</button>
                </div>
                <div class="page">
                    <div class="wm">مدفوع</div>

                    <div class="rh">
                        <div class="rh-logo">
                            <img src="${logoUrl}" onerror="this.style.display='none'">
                            <div class="rh-logo-text">
                                <h2>مؤسسة النهرين التعليمية</h2>
                                <p>AL-NAHRAIN EDUCATIONAL INSTITUTION</p>
                            </div>
                        </div>
                        <div class="rh-title">
                            <h1>وصل قبض</h1>
                            <span>PAYMENT RECEIPT</span>
                        </div>
                    </div>

                    <div class="cb">
                        <div class="cb-name">
                            <small>اسم الطالب / Student Name</small>
                            <strong>${studentName}</strong>
                        </div>
                        <div class="cb-meta">
                            <div class="mi">
                                <small>رقم السند</small>
                                <strong>${displayNum}</strong>
                            </div>
                            <div class="mi">
                                <small>تاريخ الإصدار</small>
                                <strong>${dateStr}</strong>
                            </div>
                            ${nextDueDate && nextDueDate !== '---' ? `
                            <div class="mi hl">
                                <small>موعد الدفعة القادمة</small>
                                <strong>${nextDueDate}</strong>
                            </div>` : ''}
                        </div>
                    </div>

                    <div class="rb">
                        <div class="sidebar">
                            <div class="si"><span class="sl">المؤسسة</span><span class="sv">مؤسسة النهرين التعليمية الدولية</span></div>
                            <div class="si"><span class="sl">الفرع</span><span class="sv">${branch.name}</span></div>
                            ${studentClass && studentClass !== '-' && studentClass !== '....................' ? `<div class="si"><span class="sl">القسم</span><span class="sv">${studentClass}</span></div>` : ''}
                            <div class="si"><span class="sl">السنة الدراسية</span><span class="sv">${window.currentAcademicYear || '2026 / 2027'}</span></div>
                            <div class="si"><span class="sl">تاريخ الطباعة</span><span class="sv">${new Date().toLocaleDateString('ar-IQ')}</span></div>
                            <div class="si"><span class="sl">بواسطة</span><span class="sv">${currentUser?.name || 'المحاسب'}</span></div>
                        </div>

                        <div class="mc">
                            <table class="dt">
                                <thead>
                                    <tr>
                                        <th style="width:35px">ت</th>
                                        <th>البيان</th>
                                        <th>التفاصيل</th>
                                        <th>المبلغ</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td style="color:#64748b;font-size:0.78rem;">1</td>
                                        <td><div class="td-desc">${note}</div></td>
                                        <td><div class="td-sub">${amountWords}</div></td>
                                        <td>${amount.toLocaleString()} د.ع</td>
                                    </tr>
                                </tbody>
                            </table>

                            ${studentUid ? `
                            <div class="sa">
                                <div class="st">
                                    <div class="sr"><span class="sl">القسط الكلي</span><span class="sv">${netTuition.toLocaleString()} د.ع</span></div>
                                    <div class="sr"><span class="sl">المسدد التراكمي</span><span class="sv">${totalPaid.toLocaleString()} د.ع</span></div>
                                    <div class="sr"><span class="sl">المبلغ المدفوع اليوم</span><span class="sv" style="color:#059669">${amount.toLocaleString()} د.ع</span></div>
                                    <div class="sr total"><span class="sl">الرصيد المتبقي</span><span class="sv">${remaining.toLocaleString()} د.ع</span></div>
                                </div>
                            </div>

                            <div class="cred">
                                <span class="cred-t">🔐 بيانات الدخول للمنصة</span>
                                <div class="cred-p"><span>اسم المستخدم: </span><b>${loginCode || '---'}</b></div>
                            </div>` : ''}
                        </div>
                    </div>

                    <div class="sigs">
                        <div class="sb"><div class="sn">المستلم</div><div class="sl2"><span>Receiver Signature</span></div></div>
                        <div class="sb"><div class="sn">المحاسب المختص</div><div class="sl2"><span>Accountant Signature</span></div></div>
                        <div class="sb"><div class="sn">الختم الرسمي</div><div class="sl2"><span>Official Stamp</span></div></div>
                    </div>

                    <div class="rf">
                        <div class="fi"><i class="fa-solid fa-location-dot"></i> السماوة، العراق</div>
                        <div class="fi"><i class="fa-solid fa-graduation-cap"></i> مؤسسة النهرين التعليمية الدولية</div>
                        <div class="fi"><i class="fa-solid fa-heart"></i> شكراً لثقتكم بنا</div>
                    </div>
                </div>
                </body>
                </html>`;
            }
            printWindow.document.write(html);
            printWindow.document.close();
            setTimeout(() => { if(printWindow && !printWindow.closed) printWindow.print(); }, 800);
        };

        window.closeAllAccModals = function() {
            ['acc-student-modal', 'acc-statement-modal', 'acc-payment-modal', 'acc-edit-transaction-modal', 'acc-hr-modal', 'acc-modal-overlay', 'bulk-reminder-modal', 'admission-approval-modal', 'acc-salary-modal'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
        };

        window.openAccStudentManage = function(uid) {
            const s = accountantStudents.find(x => String(x.uid) === String(uid));
            if (!s) return;
            const tuition = (s.finance?.tuition !== undefined && s.finance.tuition !== '') ? Number(s.finance.tuition) : (Number(accountantFinance.defaults[s.classId]) || 0);
            document.getElementById('acc-modal-uid').value = s.uid;
            document.getElementById('acc-modal-student-name').innerText = 'إدارة حساب الطالب: ' + s.name;
            document.getElementById('acc-modal-tuition').value = tuition || '';
            document.getElementById('acc-modal-discount').value = s.finance?.discount || '';
            document.getElementById('acc-modal-discount-note').value = s.finance?.discountNote || '';
            document.getElementById('acc-modal-transport-fee').value = s.finance?.transportFee || '';
            document.getElementById('acc-modal-transport-route').value = s.finance?.transportRoute || '';
            ['inst1', 'inst2', 'inst3', 'inst4', 'inst5'].forEach(k => { const el = document.getElementById('acc-modal-' + k); if (el) el.value = s.finance?.[k] || ''; });
            document.getElementById('acc-modal-doc-url').value = s.finance?.docUrl || '';
            document.getElementById('acc-modal-overlay').style.display = 'block';
            document.getElementById('acc-student-modal').style.display = 'block';
        };

        window.saveAccStudentSettings = function() {
            const uid = document.getElementById('acc-modal-uid').value;
            const data = {
                tuition: document.getElementById('acc-modal-tuition').value,
                discount: document.getElementById('acc-modal-discount').value,
                discountNote: document.getElementById('acc-modal-discount-note').value,
                transportFee: document.getElementById('acc-modal-transport-fee').value,
                transportRoute: document.getElementById('acc-modal-transport-route').value,
                inst1: document.getElementById('acc-modal-inst1').value,
                inst2: document.getElementById('acc-modal-inst2').value,
                inst3: document.getElementById('acc-modal-inst3').value,
                inst4: document.getElementById('acc-modal-inst4').value,
                inst5: document.getElementById('acc-modal-inst5').value,
                docUrl: document.getElementById('acc-modal-doc-url').value
            };
            _restUpdate(`users/${uid}/finance`, data).then(() => {
                showCustomAlert('تم الحفظ', 'تم تحديث البيانات المالية بنجاح', 'success');
                window.closeAllAccModals();
                loadAccountantData();
            }).catch(e => alert('خطأ في الحفظ: ' + e.message));
        };

        window.openAccStudentPayment = function(uid) {
            const s = accountantStudents.find(x => String(x.uid) === String(uid));
            if (!s) return;
            document.getElementById('acc-payment-uid').value = s.uid;
            document.getElementById('acc-payment-name').value = s.name;
            document.getElementById('acc-payment-modal-title').innerText = 'استلام مبلغ من: ' + s.name;
            document.getElementById('acc-payment-amount').value = '';
            document.getElementById('acc-payment-note').value = 'تسديد قسط الطالب ' + s.name;
            document.getElementById('acc-payment-next-date').value = '';
            document.getElementById('acc-modal-overlay').style.display = 'block';
            document.getElementById('acc-payment-modal').style.display = 'block';
        };

        window.printReceiptFromStatement = function(txId) {
            const r = accountantFinance.revenues.find(x => x.id === txId);
            if (!r) return alert('خطأ: لم يتم العثور على بيانات الوصل');
            const dateStr = new Date(r.timestamp).toLocaleDateString('ar-IQ');
            window.printAccReceipt(r.id, 'revenue', r.amount, r.note, dateStr, 'تسديد قسط', r.studentUid);
        };

        window.switchStatTab = function(tabId) {
            document.querySelectorAll('.stat-tab-content').forEach(el => el.style.display = 'none');
            document.querySelectorAll('.tab-btn').forEach(el => {
                el.classList.remove('active');
                el.style.borderBottom = '3px solid transparent';
                el.style.color = '#64748b';
            });
            
            document.getElementById('stat-tab-' + tabId).style.display = 'block';
            const activeBtn = document.getElementById('btn-stat-tab-' + tabId);
            activeBtn.classList.add('active');
            activeBtn.style.borderBottom = '3px solid #3b82f6';
            activeBtn.style.color = '#3b82f6';
            
            if (tabId === 'transport') {
                renderStudentTransportHistory(window.currentStatementUid);
            }
        };

        window.openAccStudentStatement = function(uid) {
            if (!uid) return;
            window.currentStatementUid = uid;
            const s = accountantStudents.find(x => String(x.uid) === String(uid));
            if (!s) return alert('خطأ: تعذر العثور على بيانات الطالب');

            // Reset tabs to default
            setTimeout(() => switchStatTab('ledger'), 50);

            const tuition = (s.finance?.tuition !== undefined && s.finance.tuition !== '') ? Number(s.finance.tuition) : (Number(accountantFinance.defaults[s.classId]) || 0);
            
            // Calculate Transport total from history instead of fixed field
            const transportHistory = s.finance?.transportHistory || {};
            const transportTotal = Object.values(transportHistory).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
            
            const discount = Number(s.finance?.discount) || 0;
            const netRequired = (tuition + transportTotal) - discount;

            // Filter transactions for this student
            const myRevs = (accountantFinance.revenues || []).filter(r => String(r.studentUid) === String(uid)).sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));
            const totalPaid = myRevs.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
            const remaining = netRequired - totalPaid;

            const headerElem = document.getElementById('acc-statement-header');
            if (headerElem) {
                headerElem.innerHTML = `
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; background:linear-gradient(to left, #f8fafc, #ffffff); padding:15px; border-radius:12px; border:1px solid #e2e8f0; box-shadow:inset 0 2px 4px rgba(0,0,0,0.02);">
                        <div>
                            <div style="font-weight:900; font-size:1.2rem; color:#1e293b;">${s.name}</div>
                            <div style="color:#64748b; font-size:0.85rem; font-weight:600;">${getClassName(s.classId)}</div>
                        </div>
                        <div style="text-align:left; border-right:2px solid #e2e8f0; padding-right:15px;">
                            <div style="color:#059669; font-weight:800; font-size:0.95rem;">المسدد الكلي: ${totalPaid.toLocaleString()} د.ع</div>
                            <div style="color:#dc2626; font-weight:800; font-size:0.95rem;">المتبقي بذمته: ${remaining.toLocaleString()} د.ع</div>
                        </div>
                    </div>`;
            }

            const bodyElem = document.getElementById('acc-statement-body');
            if (bodyElem) {
                let html = myRevs.map(r => `
                    <tr>
                        <td style="font-size:0.8rem;">${new Date(r.timestamp).toLocaleDateString('ar-IQ')}</td>
                        <td style="font-family:monospace; color:#94a3b8; font-size:0.75rem;">#${r.id.substring(0,8).toUpperCase()}</td>
                        <td style="font-weight:600; color:#475569;">${r.note || 'تسديد قسط'}</td>
                        <td style="font-weight:800; color:#1e3a8a;">${Number(r.amount).toLocaleString()} د.ع</td>
                        <td>
                            <button class="quick-action-btn" style="background:#f1f5f9; color:#475569;" onclick="window.printReceiptFromStatement('${r.id}')" title="طباعة الوصل">
                                <i class="fa-solid fa-print"></i>
                            </button>
                        </td>
                    </tr>`).join('');
                bodyElem.innerHTML = html || '<tr><td colspan="5" style="text-align:center; padding:30px; color:#94a3b8;"><i class="fa-solid fa-folder-open" style="font-size:2rem; display:block; margin-bottom:10px;"></i> لا توجد حركات مالية مسجلة لهذا الطالب</td></tr>';
            }

            const overlay = document.getElementById('acc-modal-overlay');
            const modal = document.getElementById('acc-statement-modal');
            if (overlay && modal) {
                overlay.style.display = 'block';
                overlay.style.zIndex = '8000';
                modal.style.display = 'block';
                modal.style.zIndex = '8001';
            }
        };

        window.renderStudentTransportHistory = function(uid) {
            const s = accountantStudents.find(x => String(x.uid) === String(uid));
            if (!s) return;
            const history = s.finance?.transportHistory || {};
            const tbody = document.getElementById('acc-transport-history-body');
            if (!tbody) return;
            
            // Financial calculations for Status
            const tuition = (s.finance && s.finance.tuition !== undefined && s.finance.tuition !== "") ? Number(s.finance.tuition) : (Number(accountantFinance.defaults[s.classId]) || 0);
            const discount = Number(s.finance?.discount) || 0;
            const totalPaid = accountantFinance.revenues.filter(r => String(r.studentUid) === String(uid)).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
            
            const transportEntries = Object.values(history).sort((a,b) => (a.timestamp || 0) - (b.timestamp || 0));
            const totalTransportFees = transportEntries.reduce((sum, item) => sum + (Number(item.amount || 0) - Number(item.discount || 0)), 0);
            
            const totalRequired = (tuition + totalTransportFees) - discount;
            const totalRemaining = totalRequired - totalPaid;

            // Render Summary Header
            const summaryDiv = document.getElementById('acc-transport-summary-info');
            if (summaryDiv) {
                summaryDiv.innerHTML = `
                    <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:15px; margin-bottom:20px; background:#f8fafc; padding:15px; border-radius:12px; border:1px solid #e2e8f0;">
                        <div style="text-align:center; border-left:1px solid #e2e8f0;">
                            <small style="display:block; color:#64748b; font-weight:700;">إجمالي أجور النقل (صافي)</small>
                            <span style="font-size:1.1rem; font-weight:900; color:#1e3a8a;">${totalTransportFees.toLocaleString()} د.ع</span>
                        </div>
                        <div style="text-align:center; border-left:1px solid #e2e8f0;">
                            <small style="display:block; color:#64748b; font-weight:700;">المسدد الكلي (شامل الدراسة)</small>
                            <span style="font-size:1.1rem; font-weight:900; color:#059669;">${totalPaid.toLocaleString()} د.ع</span>
                        </div>
                        <div style="text-align:center;">
                            <small style="display:block; color:#64748b; font-weight:700;">الذمة المتبقية (الكلية)</small>
                            <span style="font-size:1.1rem; font-weight:900; color:${totalRemaining > 0 ? '#e11d48' : '#059669'};">${totalRemaining.toLocaleString()} د.ع</span>
                        </div>
                    </div>
                `;
            }
            
            // Accurate status: check which subscriptions have a linked payment via transportDateKey
            const paidDateKeys = new Set(
                (accountantFinance.revenues || [])
                    .filter(r => String(r.studentUid) === String(uid) && r.transportDateKey)
                    .map(r => r.transportDateKey)
            );

            const fmtDate = d => d ? new Date(d).toLocaleDateString('ar-IQ', { day: 'numeric', month: 'long', year: 'numeric' }) : '---';

            let html = '';
            const displayEntries = [...transportEntries].reverse();

            displayEntries.forEach(item => {
                const itemNet = Number(item.amount || 0) - Number(item.discount || 0);
                const hasDiscount = Number(item.discount || 0) > 0;
                const isPaid = paidDateKeys.has(item.dateKey);

                const periodFrom = fmtDate(item.startDate);
                const periodTo   = fmtDate(item.endDate);

                const vehicleIcon = item.vehicle === 'خصوصي' ? '🚗 خصوصي' : '🚌 باص مدرسي';

                let statusBadge, rowBg;
                if (isPaid) {
                    statusBadge = '<span class="acc-badge" style="background:#dcfce7; color:#15803d; border:1px solid #bbf7d0; font-weight:800; padding:4px 10px; border-radius:20px;"><i class="fa-solid fa-circle-check"></i> مسدد</span>';
                    rowBg = '#f0fdf4';
                } else {
                    statusBadge = '<span class="acc-badge" style="background:#fff1f2; color:#be123c; border:1px solid #fecdd3; font-weight:800; padding:4px 10px; border-radius:20px;"><i class="fa-solid fa-circle-xmark"></i> بذمة الطالب</span>';
                    rowBg = '#fff8f8';
                }

                html += `
                    <tr style="background:${rowBg};">
                        <td style="font-size:0.82rem; font-weight:700; color:#1e3a8a;">
                            <div>${periodFrom}</div>
                            <div style="color:#64748b; font-size:0.72rem; font-weight:600;">↓</div>
                            <div>${periodTo}</div>
                        </td>
                        <td style="font-weight:600; color:#334155;">${item.area || '---'}</td>
                        <td style="color:#475569;">${item.driver || '---'}</td>
                        <td style="font-size:0.8rem; font-weight:600;">${vehicleIcon}</td>
                        <td style="text-align:center;">
                            ${hasDiscount ? `<div style="font-size:0.72rem; color:#94a3b8; text-decoration:line-through;">${Number(item.amount).toLocaleString()}</div>` : ''}
                            <div style="font-weight:900; color:#1e3a8a; font-size:0.95rem;">${itemNet.toLocaleString()} د.ع</div>
                            ${hasDiscount ? `<div style="font-size:0.68rem; color:#16a34a; font-weight:700;">خصم: ${Number(item.discount).toLocaleString()}</div>` : ''}
                        </td>
                        <td style="text-align:center;">${statusBadge}</td>
                        <td>
                            <div style="display:flex; gap:5px; justify-content:center;">
                                <button class="quick-action-btn" style="background:#f0fdf4; color:#16a34a;" onclick="printTransportMonthReceipt('${uid}', '${item.dateKey}')" title="وصل استلام">
                                    <i class="fa-solid fa-receipt"></i>
                                </button>
                                <button class="quick-action-btn" style="background:#fff1f2; color:#e11d48;" onclick="deleteTransportSubscription('${item.dateKey}')" title="حذف">
                                    <i class="fa-solid fa-trash-can"></i>
                                </button>
                            </div>
                        </td>
                    </tr>`;
            });
            tbody.innerHTML = html || '<tr><td colspan="7" style="text-align:center; padding:30px; color:#94a3b8;"><i class="fa-solid fa-bus-slash" style="font-size:2rem; display:block; margin-bottom:8px;"></i>لا توجد اشتراكات نقل مسجلة</td></tr>';
        };

        window.saveStudentTransportSubscription = async function() {
            const uid = window.currentStatementUid;
            const startDate = document.getElementById('acc-trans-start-date').value;
            const endDate = document.getElementById('acc-trans-end-date').value;
            const area = document.getElementById('acc-trans-area').value;
            const driver = document.getElementById('acc-trans-driver').value;
            const vehicle = document.getElementById('acc-trans-vehicle').value;
            const type = document.getElementById('acc-trans-type').value;
            const amount = Number(document.getElementById('acc-trans-amount').value) || 0;
            const discount = Number(document.getElementById('acc-trans-discount').value) || 0;

            if (!startDate || !area || amount <= 0) {
                return showCustomAlert('تنبيه', 'يرجى إكمال بيانات الاشتراك (تاريخ البداية، المنطقة، والمبلغ)', 'warning');
            }

            // Overlap Check
            const s = accountantStudents.find(x => String(x.uid) === String(uid));
            if (s && s.finance?.transportHistory) {
                const history = Object.values(s.finance.transportHistory);
                const newStart = new Date(startDate);
                const newEnd = endDate ? new Date(endDate) : new Date(startDate);

                const isOverlap = history.some(h => {
                    const hStart = new Date(h.startDate);
                    const hEnd = h.endDate ? new Date(h.endDate) : new Date(h.startDate);
                    return (newStart <= hEnd && newEnd >= hStart);
                });

                if (isOverlap) {
                    const proceed = await showAccConfirm('تداخل في الفترة', 'هذا الطالب لديه اشتراك مسجل بالفعل يتداخل مع هذه الفترة الزمنية. هل أنت متأكد من إضافة اشتراك جديد؟');
                    if (!proceed) return;
                }
            }

            const saveBtn = document.getElementById('acc-trans-save-btn');
            if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '⏳ جاري الحفظ...'; }

            const dateKey = startDate.replace(/-/g, '') + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
            const dateLabel = new Date(startDate).toLocaleDateString('ar-IQ', { day: 'numeric', month: 'long', year: 'numeric' });

            const entry = {
                dateKey,
                startDate,
                endDate,
                dateLabel,
                area,
                driver,
                vehicle,
                type,
                amount,
                discount,
                timestamp: Date.now()
            };

            try {
                await _restSet(`users/${uid}/finance/transportHistory/${dateKey}`, entry);
                showCustomAlert('تم التثبيت', `تم تسجيل الاشتراك بنجاح ✅ الصافي: ${(amount - discount).toLocaleString()} د.ع`, 'success');

                document.getElementById('acc-trans-start-date').value = '';
                document.getElementById('acc-trans-end-date').value = '';
                document.getElementById('acc-trans-area').value = '';
                document.getElementById('acc-trans-driver').value = '';
                document.getElementById('acc-trans-amount').value = '';
                document.getElementById('acc-trans-discount').value = '0';
                if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '✅ تثبيت الاشتراك والاحتساب'; }

                await loadAccountantData();
                renderStudentTransportHistory(uid);
                openAccStudentStatement(uid);
                switchStatTab('transport');
            } catch (e) {
                console.error(e);
                if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '✅ تثبيت الاشتراك والاحتساب'; }
                showCustomAlert('خطأ', 'فشل في حفظ البيانات: ' + e.message, 'error');
            }
        };

        window.printTransportMonthReceipt = async function(uid, dateKey) {
            const s = accountantStudents.find(x => String(x.uid) === String(uid));
            if (!s || !s.finance?.transportHistory?.[dateKey]) return;
            const item = s.finance.transportHistory[dateKey];
            const netAmount = Number(item.amount || 0) - Number(item.discount || 0);
            
            // Check if already paid (by looking for transportDateKey in revenues)
            const isAlreadyPaid = accountantFinance.revenues.some(r => String(r.studentUid) === String(uid) && r.transportDateKey === dateKey);
            
            let shouldRecordPayment = false;
            if (!isAlreadyPaid) {
                shouldRecordPayment = await showAccConfirm('تسجيل الاستلام', `هل تود تسجيل استلام مبلغ الصافي (${netAmount.toLocaleString()} د.ع) وإضافته لحساب الطالب؟`);
            }
            
            if (shouldRecordPayment) {
                const txId = 'REV-' + Date.now();
                const paymentData = {
                    id: txId,
                    amount: netAmount,
                    note: `أجور نقل (من: ${item.startDate} إلى: ${item.endDate || '---'}) - ${item.area}`,
                    studentUid: uid,
                    transportDateKey: dateKey, // Link this payment to the specific subscription period
                    timestamp: Date.now(),
                    branchId: currentUser ? currentUser.branchId : 'samawah',
                    user: currentUser ? currentUser.name : 'محاسب',
                    category: 'أجور نقل'
                };
                
                try {
                    await _restSet(`finance/revenues/${txId}`, paymentData);
                    await loadAccountantData();
                    showCustomAlert('تم التسجيل', 'تم تسجيل المبلغ الصافي بنجاح', 'success');
                } catch (e) { console.error(e); }
            }

            const dateStr = new Date().toLocaleDateString('ar-IQ');
            const userBranchId = currentUser ? currentUser.branchId : 'samawah';
            const branch = (window.NAHRAIN_BRANCHES && window.NAHRAIN_BRANCHES[userBranchId]) ? window.NAHRAIN_BRANCHES[userBranchId] : { name: 'مدرسة النهرين الأهلية', logo: '' };

            const printWin = window.open('', '_blank');
            if (!printWin) return;

            const fmtD = d => d ? new Date(d).toLocaleDateString('ar-IQ', { day: 'numeric', month: 'long', year: 'numeric' }) : '---';
            const receiptNo = '#' + item.dateKey.replace(/\D/g, '').slice(-6);
            const nowStr = new Date().toLocaleDateString('ar-IQ', { day: 'numeric', month: 'long', year: 'numeric' });
            const vehicleIcon = item.vehicle === 'خصوصي' ? '🚗' : '🚌';

            const receiptBlock = (copyLabel) => `
            <div class="receipt">
                <div class="r-top-bar">
                    <div class="r-school">${branch.name}</div>
                    <div class="r-subtitle">وصل استلام أجور نقل</div>
                </div>

                <div class="r-meta-row">
                    <span>رقم الوصل: <b>${receiptNo}</b></span>
                    <span class="r-copy-label">${copyLabel}</span>
                    <span>التاريخ: <b>${nowStr}</b></span>
                </div>

                <div class="r-body">
                    <div class="r-row">
                        <span class="r-lbl">اسم الطالب</span>
                        <span class="r-val r-name">${s.name}</span>
                    </div>
                    <div class="r-row">
                        <span class="r-lbl">الصف / الشعبة</span>
                        <span class="r-val">${getClassName(s.classId)}</span>
                    </div>
                    <div class="r-row r-period">
                        <span class="r-lbl">فترة الاشتراك</span>
                        <span class="r-val r-period-val">من ${fmtD(item.startDate)} &nbsp;←&nbsp; إلى ${fmtD(item.endDate)}</span>
                    </div>
                    <div class="r-row2">
                        <div class="r-row r-half">
                            <span class="r-lbl">المنطقة</span>
                            <span class="r-val">${item.area || '---'}</span>
                        </div>
                        <div class="r-row r-half">
                            <span class="r-lbl">السائق</span>
                            <span class="r-val">${item.driver || '---'}</span>
                        </div>
                    </div>
                    <div class="r-row2">
                        <div class="r-row r-half">
                            <span class="r-lbl">نوع المركبة</span>
                            <span class="r-val">${vehicleIcon} ${item.vehicle || '---'}</span>
                        </div>
                        <div class="r-row r-half">
                            <span class="r-lbl">نوع الخط</span>
                            <span class="r-val">${item.type || '---'}</span>
                        </div>
                    </div>
                </div>

                <div class="r-amount-box">
                    <div class="r-amount-rows">
                        <div class="r-amt-row">
                            <span>الأجور الأصلية</span>
                            <span>${Number(item.amount).toLocaleString()} د.ع</span>
                        </div>
                        ${Number(item.discount) > 0 ? `
                        <div class="r-amt-row r-discount">
                            <span>الخصم الممنوح</span>
                            <span>- ${Number(item.discount).toLocaleString()} د.ع</span>
                        </div>` : ''}
                    </div>
                    <div class="r-net">
                        <div class="r-net-label">المبلغ الصافي المستلم</div>
                        <div class="r-net-val">${netAmount.toLocaleString()}<span class="r-currency"> د.ع</span></div>
                        <div class="r-words">فقط ${convertNumberToWords(netAmount)} دينار عراقي لا غير</div>
                    </div>
                </div>

                <div class="r-sigs">
                    <div class="r-sig"><div class="r-sig-line"></div><div class="r-sig-lbl">توقيع ولي الأمر</div></div>
                    <div class="r-sig"><div class="r-sig-line"></div><div class="r-sig-lbl">الختم الرسمي</div></div>
                    <div class="r-sig"><div class="r-sig-line"></div><div class="r-sig-lbl">توقيع المحاسب</div></div>
                </div>
            </div>`;

            printWin.document.write(`
                <html dir="rtl">
                <head>
                    <title>وصل نقل - ${s.name}</title>
                    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
                    <style>
                        * { box-sizing: border-box; margin: 0; padding: 0; }
                        body { font-family: 'Cairo', sans-serif; background: #e2e8f0; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; gap: 0; }

                        .print-btn { background: #1e3a8a; color: #fff; border: none; border-radius: 8px; padding: 10px 32px; font-family: Cairo, sans-serif; font-size: 1rem; font-weight: 700; cursor: pointer; margin-bottom: 18px; }

                        .receipt {
                            background: #fff;
                            width: 190mm;
                            border: 2px solid #1e3a8a;
                            border-radius: 0;
                            position: relative;
                            overflow: hidden;
                        }

                        .r-top-bar {
                            background: #1e3a8a;
                            color: #fff;
                            padding: 10px 20px;
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                        }
                        .r-school { font-size: 1.1rem; font-weight: 900; }
                        .r-subtitle { font-size: 0.85rem; font-weight: 700; background: rgba(255,255,255,0.15); padding: 3px 12px; border-radius: 20px; }

                        .r-meta-row {
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                            padding: 7px 20px;
                            background: #f1f5f9;
                            border-bottom: 1px solid #e2e8f0;
                            font-size: 0.78rem;
                            font-weight: 700;
                            color: #475569;
                        }
                        .r-copy-label { background: #1e3a8a; color: #fff; padding: 2px 14px; border-radius: 20px; font-size: 0.72rem; font-weight: 900; }

                        .r-body { padding: 10px 20px; }
                        .r-row { display: flex; align-items: center; border-bottom: 1px dashed #e2e8f0; padding: 5px 0; gap: 10px; }
                        .r-row2 { display: flex; gap: 0; }
                        .r-half { flex: 1; border-left: 1px dashed #e2e8f0; padding-left: 12px; }
                        .r-half:last-child { border-left: none; padding-left: 0; padding-right: 12px; }
                        .r-lbl { font-size: 0.72rem; color: #64748b; font-weight: 700; width: 100px; flex-shrink: 0; }
                        .r-val { font-size: 0.85rem; font-weight: 900; color: #0f172a; flex: 1; }
                        .r-name { font-size: 1rem; color: #1e3a8a; }
                        .r-period { background: #fff8f0; margin: 4px 0; border-radius: 4px; padding: 6px 8px; border-bottom: none; border: 1px solid #fed7aa; }
                        .r-period-val { color: #c2410c; font-size: 0.88rem; }

                        .r-amount-box {
                            margin: 10px 20px;
                            border: 2px solid #1e3a8a;
                            border-radius: 8px;
                            overflow: hidden;
                            display: flex;
                        }
                        .r-amount-rows { flex: 1; padding: 8px 14px; border-left: 2px solid #1e3a8a; }
                        .r-amt-row { display: flex; justify-content: space-between; font-size: 0.8rem; font-weight: 700; color: #475569; padding: 3px 0; border-bottom: 1px solid #f1f5f9; }
                        .r-discount { color: #16a34a; }
                        .r-net { flex: 1.2; text-align: center; padding: 8px 10px; background: #f0f4ff; display: flex; flex-direction: column; justify-content: center; }
                        .r-net-label { font-size: 0.7rem; font-weight: 700; color: #64748b; margin-bottom: 2px; }
                        .r-net-val { font-size: 1.8rem; font-weight: 900; color: #1e3a8a; line-height: 1.1; }
                        .r-currency { font-size: 0.85rem; }
                        .r-words { font-size: 0.65rem; font-weight: 700; color: #475569; margin-top: 3px; background: #fff; border-radius: 20px; padding: 2px 8px; border: 1px solid #e2e8f0; display: inline-block; }

                        .r-sigs { display: flex; justify-content: space-around; padding: 10px 20px 12px; border-top: 1px solid #e2e8f0; margin-top: 6px; }
                        .r-sig { text-align: center; width: 130px; }
                        .r-sig-line { border-top: 1px solid #334155; margin-bottom: 4px; }
                        .r-sig-lbl { font-size: 0.7rem; font-weight: 700; color: #475569; }

                        .divider {
                            width: 190mm;
                            border: none;
                            border-top: 2px dashed #94a3b8;
                            margin: 12px 0;
                            position: relative;
                        }
                        .divider::before { content: '✂'; position: absolute; right: -10px; top: -10px; font-size: 1rem; color: #94a3b8; }

                        @media print {
                            @page { size: A4 portrait; margin: 8mm; }
                            body { background: #fff; padding: 0; justify-content: flex-start; }
                            .print-btn { display: none; }
                            .receipt { width: 100%; border: 2px solid #000; }
                            .divider { width: 100%; }
                            -webkit-print-color-adjust: exact;
                            print-color-adjust: exact;
                        }
                    </style>
                </head>
                <body onload="window.print()">
                    <button class="print-btn" onclick="window.print()">🖨️ طباعة</button>
                    ${receiptBlock('نسخة المدرسة')}
                    <div class="divider"></div>
                    ${receiptBlock('نسخة ولي الأمر')}
                </body>
                </html>
            `);
            printWin.document.close();
        };
        
        window.printFullTransportReport = function() {
            const branchId = currentUser?.branchId || 'samawah';
            const branch = window.NAHRAIN_BRANCHES[branchId] || { name: 'مدرسة النهرين' };

            const fmtD = d => d ? new Date(d).toLocaleDateString('ar-IQ', { day: 'numeric', month: 'long', year: 'numeric' }) : '---';

            // Gather all transport entries
            let allEntries = [];
            accountantStudents.forEach(s => {
                if (s.finance?.transportHistory) {
                    Object.keys(s.finance.transportHistory).forEach(dateKey => {
                        const entry = s.finance.transportHistory[dateKey];
                        const isPaid = (accountantFinance.revenues || []).some(r =>
                            String(r.studentUid) === String(s.uid) && String(r.transportDateKey) === String(dateKey)
                        );
                        allEntries.push({
                            studentName: s.name,
                            studentClass: getClassName(s.classId),
                            ...entry,
                            isPaid,
                            dateKey
                        });
                    });
                }
            });

            allEntries.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

            const totalNet   = allEntries.reduce((s, e) => s + (Number(e.amount||0) - Number(e.discount||0)), 0);
            const totalPaid  = allEntries.filter(e => e.isPaid).reduce((s, e) => s + (Number(e.amount||0) - Number(e.discount||0)), 0);
            const totalUnpaid = totalNet - totalPaid;
            const paidCount   = allEntries.filter(e => e.isPaid).length;
            const unpaidCount = allEntries.length - paidCount;

            const printWindow = window.open('', '_blank');
            const html = `
                <html dir="rtl">
                <head>
                    <title>كشف مشتركي خطوط النقل - ${branch.name}</title>
                    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
                    <style>
                        * { box-sizing: border-box; margin: 0; padding: 0; }
                        body { font-family: 'Cairo', sans-serif; direction: rtl; padding: 20px; color: #1e293b; background: #fff; font-size: 0.82rem; }
                        .header { text-align: center; border-bottom: 3px double #1e3a8a; padding-bottom: 14px; margin-bottom: 18px; }
                        .header h1 { color: #1e3a8a; font-size: 1.5rem; font-weight: 900; margin-bottom: 4px; }
                        .header .branch { color: #475569; font-size: 0.95rem; font-weight: 700; }
                        .meta-row { display: flex; justify-content: center; gap: 24px; margin-top: 10px; font-size: 0.82rem; font-weight: 700; color: #475569; }
                        .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
                        .sum-box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; text-align: center; }
                        .sum-box .label { font-size: 0.72rem; color: #64748b; font-weight: 700; margin-bottom: 4px; }
                        .sum-box .value { font-size: 1rem; font-weight: 900; }
                        table { width: 100%; border-collapse: collapse; margin-top: 4px; }
                        th { background: #1e3a8a; color: #fff; padding: 9px 8px; text-align: center; font-weight: 900; font-size: 0.8rem; }
                        td { border: 1px solid #e2e8f0; padding: 8px; vertical-align: middle; }
                        tr:nth-child(even) td { background: #f8fafc; }
                        .paid-row td { background: #f0fdf4 !important; }
                        .unpaid-row td { background: #fff8f8 !important; }
                        .badge-paid { display:inline-block; background:#dcfce7; color:#15803d; border:1px solid #bbf7d0; border-radius:12px; padding:2px 10px; font-weight:900; font-size:0.75rem; }
                        .badge-unpaid { display:inline-block; background:#fff1f2; color:#be123c; border:1px solid #fecdd3; border-radius:12px; padding:2px 10px; font-weight:900; font-size:0.75rem; }
                        .total-row td { background: #f1f5f9 !important; font-weight: 900; color: #1e3a8a; border-top: 2px solid #1e3a8a; }
                        .footer { margin-top: 36px; display: flex; justify-content: space-around; }
                        .sig-box { width: 180px; text-align: center; }
                        .sig-line { border-top: 1px solid #334155; margin-top: 32px; padding-top: 6px; font-size: 0.78rem; font-weight: 700; color: #475569; }
                        .no-print { display: flex; justify-content: center; margin-bottom: 16px; }
                        @media print { .no-print { display: none; } @page { margin: 10mm; size: A4 landscape; } }
                    </style>
                </head>
                <body>
                    <div class="no-print">
                        <button onclick="window.print()" style="background:#1e3a8a; color:#fff; border:none; border-radius:8px; padding:9px 28px; font-family:Cairo,sans-serif; font-size:1rem; font-weight:700; cursor:pointer;">🖨️ طباعة الكشف</button>
                    </div>
                    <div class="header">
                        <h1>🚌 كشف مشتركي خطوط النقل الشامل</h1>
                        <div class="branch">${branch.name}</div>
                        <div class="meta-row">
                            <span>📅 تاريخ الإصدار: <b>${new Date().toLocaleDateString('ar-IQ', { day:'numeric', month:'long', year:'numeric' })}</b></span>
                            <span>📋 إجمالي الاشتراكات: <b>${allEntries.length}</b></span>
                        </div>
                    </div>

                    <div class="summary-grid">
                        <div class="sum-box" style="border-color:#cbd5e1;">
                            <div class="label">إجمالي أجور النقل</div>
                            <div class="value" style="color:#1e3a8a;">${totalNet.toLocaleString()} <small style="font-size:0.65rem;">د.ع</small></div>
                        </div>
                        <div class="sum-box" style="border-color:#bbf7d0; background:#f0fdf4;">
                            <div class="label">المبالغ المحصلة (${paidCount} اشتراك)</div>
                            <div class="value" style="color:#15803d;">${totalPaid.toLocaleString()} <small style="font-size:0.65rem;">د.ع</small></div>
                        </div>
                        <div class="sum-box" style="border-color:#fecdd3; background:#fff8f8;">
                            <div class="label">المبالغ غير المحصلة (${unpaidCount} اشتراك)</div>
                            <div class="value" style="color:#be123c;">${totalUnpaid.toLocaleString()} <small style="font-size:0.65rem;">د.ع</small></div>
                        </div>
                        <div class="sum-box" style="border-color:#e2e8f0;">
                            <div class="label">نسبة التحصيل</div>
                            <div class="value" style="color:#7c3aed;">${totalNet > 0 ? Math.round((totalPaid/totalNet)*100) : 0}%</div>
                        </div>
                    </div>

                    <table>
                        <thead>
                            <tr>
                                <th style="width:28px;">#</th>
                                <th>اسم الطالب</th>
                                <th>الشعبة</th>
                                <th>المنطقة</th>
                                <th>اسم السائق</th>
                                <th>نوع المركبة</th>
                                <th>من تاريخ</th>
                                <th>إلى تاريخ</th>
                                <th>المبلغ الصافي</th>
                                <th>حالة التسديد</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${allEntries.map((e, i) => {
                                const net = Number(e.amount||0) - Number(e.discount||0);
                                return `
                                <tr class="${e.isPaid ? 'paid-row' : 'unpaid-row'}">
                                    <td style="text-align:center; font-weight:700; color:#64748b;">${i + 1}</td>
                                    <td style="font-weight:900; color:#1e3a8a;">${e.studentName}</td>
                                    <td style="font-size:0.75rem; color:#475569;">${e.studentClass}</td>
                                    <td style="font-weight:700;">${e.area || '---'}</td>
                                    <td style="color:#475569;">${e.driver || '---'}</td>
                                    <td style="text-align:center;">${e.vehicle === 'خصوصي' ? '🚗 خصوصي' : '🚌 باص'}</td>
                                    <td style="text-align:center; font-weight:700; color:#0f172a;">${fmtD(e.startDate)}</td>
                                    <td style="text-align:center; font-weight:700; color:#0f172a;">${fmtD(e.endDate)}</td>
                                    <td style="text-align:center; font-weight:900; color:#1e3a8a;">${net.toLocaleString()} د.ع</td>
                                    <td style="text-align:center;">${e.isPaid ? '<span class="badge-paid">✔ مسدد</span>' : '<span class="badge-unpaid">✖ بذمته</span>'}</td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                        <tfoot>
                            <tr class="total-row">
                                <td colspan="8" style="text-align:center;">الإجمالي الكلي</td>
                                <td style="text-align:center;">${totalNet.toLocaleString()} د.ع</td>
                                <td style="text-align:center;">محصل: ${totalPaid.toLocaleString()} | متبقي: ${totalUnpaid.toLocaleString()}</td>
                            </tr>
                        </tfoot>
                    </table>

                    <div class="footer">
                        <div class="sig-box"><div class="sig-line">توقيع المحاسب</div></div>
                        <div class="sig-box"><div class="sig-line">توقيع مدير الفرع</div></div>
                        <div class="sig-box"><div class="sig-line">ختم الإدارة</div></div>
                    </div>
                </body>
                </html>
            `;
            printWindow.document.write(html);
            printWindow.document.close();
        };

        window.deleteTransportSubscription = async function(dateKey) {
            const confirmed = await showAccConfirm('تأكيد الإجراء', 'هل أنت متأكد من حذف هذا الاشتراك؟');
            if (!confirmed) return;
            
            const uid = window.currentStatementUid;
            try {
                await _restSet(`users/${uid}/finance/transportHistory/${dateKey}`, null);
                
                // Add to Audit Log
                if (window.addAccAuditLog) {
                    window.addAccAuditLog('حذف اشتراك نقل', `تم حذف سجل الاشتراك (${dateKey}) للطالب ذو المعرف (${uid})`);
                }
                
                await loadAccountantData();
                if (typeof renderStudentTransportHistory === 'function') renderStudentTransportHistory(uid);
                if (typeof openAccStudentStatement === 'function') openAccStudentStatement(uid);
                if (typeof switchStatTab === 'function') switchStatTab('transport');
                
                showCustomAlert('تم الحذف', 'تم حذف الاشتراك بنجاح ✅', 'success');
            } catch (e) { 
                console.error(e);
                showCustomAlert('خطأ', 'فشل في حذف الاشتراك: ' + e.message, 'error');
            }
        };


        // Helper to convert numbers to words (Simple version for common transport amounts)
        function convertNumberToWords(amount) {
            const map = {
                25000: "خمسة وعشرون ألف",
                30000: "ثلاثون ألف",
                35000: "خمسة وثلاثون ألف",
                40000: "أربعون ألف",
                45000: "خمسة وأربعون ألف",
                50000: "خمسون ألف",
                55000: "خمسة وخمسون ألف",
                60000: "ستون ألف",
                65000: "خمسة وستون ألف",
                70000: "سبعون ألف",
                75000: "خمسة وسبعون ألف",
                80000: "ثمانون ألف",
                85000: "خمسة وثمانون ألف",
                90000: "تسعون ألف",
                100000: "مائة ألف",
                120000: "مائة وعشرون ألف",
                150000: "مائة وخمسون ألف"
            };
            return map[amount] || amount.toLocaleString();
        }



        window.printFullStudentStatement = function(uid) {
            const s = accountantStudents.find(x => String(x.uid) === String(uid));
            if (!s) return;
            
            const userBranchId = currentUser ? currentUser.branchId : 'samawah';
            const branch = (window.NAHRAIN_BRANCHES && window.NAHRAIN_BRANCHES[userBranchId]) ? window.NAHRAIN_BRANCHES[userBranchId] : { name: 'مدرسة النهرين الأهلية', logo: '' };
            
            const tuition = (s.finance?.tuition !== undefined && s.finance.tuition !== '') ? Number(s.finance.tuition) : (Number(accountantFinance.defaults[s.classId]) || 0);
            
            // Dynamic Transport
            const transportHistory = s.finance?.transportHistory || {};
            const transportItems = Object.values(transportHistory).sort((a,b) => a.timestamp - b.timestamp);
            const transportTotal = transportItems.reduce((sum, item) => sum + (Number(item.amount || 0) - Number(item.discount || 0)), 0);
            
            const discount = Number(s.finance?.discount) || 0;
            const netRequired = (tuition + transportTotal) - discount;
            const myRevs = (accountantFinance.revenues || []).filter(r => String(r.studentUid) === String(uid)).sort((a,b) => a.timestamp - b.timestamp);
            const totalPaid = myRevs.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
            const remaining = netRequired - totalPaid;

            const printWin = window.open('', '_blank');
            if (!printWin) return showCustomAlert('تنبيه', 'يرجى السماح بالنوافذ المنبثقة لطباعة كشف الحساب', 'warning');
            printWin.document.write(`
                <html dir="rtl">
                <head>
                    <title>كشف حساب - ${s.name}</title>
                    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap" rel="stylesheet">
                    <style>
                        body { font-family: 'Cairo', sans-serif; padding: 20px; color: #333; background: #fff; margin:0; }
                        .a4-container { width: 190mm; margin: 0 auto; background: white; padding: 5mm; box-sizing: border-box; }
                        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #1e3a8a; padding-bottom: 10px; margin-bottom: 20px; }
                        .header-info h1 { margin: 0; color: #1e3a8a; font-size: 1.6rem; }
                        .header-logo img { height: 65px; }
                        .doc-title { text-align: center; font-size: 1.4rem; font-weight: 900; margin-bottom: 15px; color: #1e3a8a; border: 2px solid #1e3a8a; display: inline-block; padding: 5px 30px; border-radius: 10px; width: auto; margin-left: auto; margin-right: auto; display: block; width: fit-content; }
                        .student-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; background: #f8fafc; padding: 15px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #e2e8f0; }
                        .finance-summary { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 20px; }
                        .sum-box { border: 2px solid #e2e8f0; padding: 10px; text-align: center; border-radius: 10px; }
                        .sum-val { display: block; font-size: 1.2rem; font-weight: 900; color: #1e3a8a; }
                        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
                        th { background: #1e3a8a; color: white; padding: 8px; font-size: 0.85rem; border: 1px solid #1e3a8a; }
                        td { border: 1px solid #e2e8f0; padding: 6px; text-align: center; font-size: 0.85rem; }
                        .section-head { background: #f1f5f9; padding: 8px; font-weight: bold; font-size: 1rem; color: #1e3a8a; margin-bottom: 10px; border-right: 4px solid #1e3a8a; }
                        .footer { margin-top: 40px; display: flex; justify-content: space-between; }
                        .sig-box { width: 180px; text-align: center; font-weight: bold; font-size: 0.85rem; }
                        .sig-line { border-top: 1.5px solid #333; margin-top: 30px; }
                        @media print { body { background: white; } .a4-container { width: 100%; padding: 0; } }
                    </style>
                </head>
                <body onload="window.print()">
                    <div class="a4-container">
                        <div class="header">
                            <div class="header-info"><h1>${branch.name}</h1><p>الحسابات المالية</p></div>
                            <div class="header-logo"><img src="${branch.logo}"></div>
                            <div style="text-align:left; font-size:0.8rem;">
                                <div>التاريخ: ${new Date().toLocaleDateString('ar-IQ')}</div>
                                <div>كود الطالب: ${uid.substring(0,8).toUpperCase()}</div>
                            </div>
                        </div>

                        <div class="doc-title">كشف الحساب المالي الموحد</div>

                        <div class="student-meta">
                            <div>اسم الطالب: <b>${s.name}</b></div>
                            <div>الصف: <b>${getClassName(s.classId)}</b></div>
                            <div>ولي الأمر: <b>${s.parentName || '---'}</b></div>
                            <div>الهاتف: <b>${s.phone || '---'}</b></div>
                        </div>

                        <div class="finance-summary">
                            <div class="sum-box"><small>المطالبة الكلية</small><span class="sum-val">${netRequired.toLocaleString()} د.ع</span></div>
                            <div class="sum-box"><small>إجمالي المسدد</small><span class="sum-val" style="color:#059669;">${totalPaid.toLocaleString()} د.ع</span></div>
                            <div class="sum-box"><small>المتبقي بذمته</small><span class="sum-val" style="color:#dc2626;">${remaining.toLocaleString()} د.ع</span></div>
                        </div>

                        ${transportItems.length > 0 ? `
                        <div class="section-head">تفاصيل اشتراكات خطوط النقل:</div>
                        <table>
                            <thead>
                                <tr>
                                    <th>الفترة</th>
                                    <th>المنطقة</th>
                                    <th>اسم السائق</th>
                                    <th>نوع الخط</th>
                                    <th>المبلغ</th>
                                    <th>الخصم</th>
                                    <th>الصافي</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${transportItems.map(t => `
                                    <tr>
                                        <td>${t.startDate || t.monthLabel}</td>
                                        <td>${t.area}</td>
                                        <td>${t.driver}</td>
                                        <td>${t.type}</td>
                                        <td>${Number(t.amount).toLocaleString()}</td>
                                        <td style="color:#16a34a;">${Number(t.discount || 0).toLocaleString()}</td>
                                        <td style="font-weight:bold;">${(Number(t.amount || 0) - Number(t.discount || 0)).toLocaleString()} د.ع</td>
                                    </tr>
                                `).join('')}
                                <tr style="background:#f8fafc; font-weight:bold;">
                                    <td colspan="6" style="text-align:left; padding-left:20px;">إجمالي أجور النقل المستحقة (بعد الخصم)</td>
                                    <td>${transportTotal.toLocaleString()} د.ع</td>
                                </tr>
                            </tbody>
                        </table>
                        ` : ''}

                        <div class="section-head">سجل المدفوعات والوصولات:</div>
                        <table>
                            <thead>
                                <tr>
                                    <th>ت</th>
                                    <th>التاريخ</th>
                                    <th>رقم الوصل</th>
                                    <th>البيان</th>
                                    <th>المبلغ الواصل</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${myRevs.length > 0 ? myRevs.map((r, idx) => `
                                    <tr>
                                        <td>${idx + 1}</td>
                                        <td>${new Date(r.timestamp).toLocaleDateString('ar-IQ')}</td>
                                        <td>#${r.id.substring(0,8).toUpperCase()}</td>
                                        <td>${r.note || 'تسديد قسط'}</td>
                                        <td style="font-weight:bold;">${Number(r.amount).toLocaleString()} د.ع</td>
                                    </tr>
                                `).join('') : '<tr><td colspan="5">لا توجد حركات مالية</td></tr>'}
                            </tbody>
                        </table>

                        <div class="footer">
                            <div class="sig-box">توقيع المحاسب<div class="sig-line"></div></div>
                            <div class="sig-box">الختم الرسمي<div class="sig-line"></div></div>
                            <div class="sig-box">توقيع المستلم<div class="sig-line"></div></div>
                        </div>
                    </div>
                </body>
                </html>
            `);
            printWin.document.close();
        };


        window.printAccDebtorsReportDetailed = function() {
            const late = []; 
            const now = new Date(); 
            const instCount = accountantFinance.installmentCount || 5; 
            const g = accountantFinance.globalDates || {};
            const revs = accountantFinance.revenues || [];
            const p = accountantFinance.globalPercents || {};
            
            accountantStudents.forEach(s => {
                const myRevs = revs.filter(r => r.studentUid === s.uid);
                let paid = myRevs.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
                
                // Find last payment date
                let lastPayDate = '---';
                if (myRevs.length > 0) {
                    const sorted = [...myRevs].sort((a,b) => b.timestamp - a.timestamp);
                    const ld = new Date(sorted[0].timestamp);
                    // Use English numerals (1, 2, 3...)
                    lastPayDate = `${ld.getFullYear()}/${ld.getMonth() + 1}/${ld.getDate()}`;
                }

                let tuition = (s.finance && s.finance.tuition !== undefined && s.finance.tuition !== "") ? Number(s.finance.tuition) : (Number(accountantFinance.defaults[s.classId]) || 0);
                let transport = Number(s.finance?.transportFee) || 0;
                let discount = Number(s.finance?.discount) || 0;
                let net = tuition + transport - discount;
                let rem = net - paid;
                
                if (rem > 0) {
                    let isLate = false;
                    let accumulatedExpectedPercent = 0;

                    ['inst1', 'inst2', 'inst3', 'inst4', 'inst5'].forEach((k, i) => { 
                        const d = s.finance?.[k] || g[k]; 
                        const percent = p['p' + (i+1)] || (100 / instCount); // Use custom percent or equal split
                        accumulatedExpectedPercent += percent;

                        if (d && new Date(d) < now) {
                            const expectedByNow = (net * (accumulatedExpectedPercent / 100));
                            if (paid < expectedByNow - 100) isLate = true; // small margin for rounding
                        }
                    });
                    if (isLate) late.push({ ...s, paid, remaining: rem, net, className: getClassName(s.classId), lastPayDate });
                }
            });

            if (late.length === 0) return alert('لا يوجد طلاب متأخرين حالياً حسب المواعيد المحددة');

            // Sort by Class Name
            late.sort((a, b) => a.className.localeCompare(b.className, 'ar'));

            const win = window.open('', '_blank');
            win.document.write(`
                <html>
                <head>
                    <title>كشف المتلكئين المطور - ${new Date().toLocaleDateString('ar-IQ')}</title>
                    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap" rel="stylesheet">
                    <style>
                        body { font-family: 'Cairo', sans-serif; direction: rtl; padding: 30px; background: #fff; color: #333; }
                        .header { text-align: center; border-bottom: 4px double #1e3a8a; padding-bottom: 15px; margin-bottom: 30px; }
                        h2 { margin: 0; color: #1e3a8a; font-size: 1.8rem; }
                        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                        th { background: #1e3a8a; color: white; padding: 12px; border: 1px solid #1e3a8a; font-size: 0.9rem; }
                        td { border: 1px solid #ddd; padding: 10px; text-align: center; font-size: 0.85rem; }
                        tr:nth-child(even) { background: #f8fafc; }
                        .summary { margin-bottom: 20px; font-weight: bold; display: flex; justify-content: space-between; background: #eff6ff; padding: 15px; border-radius: 8px; border: 1px solid #bfdbfe; }
                        @media print { .no-print { display: none; } }
                    </style>
                </head>
                <body onload="window.print()">
                    <div class="header">
                        <h2>مدرسة النهرين الأهلية - كشف المتلكئين</h2>
                        <p>تاريخ استخراج الكشف: ${new Date().toLocaleDateString('en-GB')} - ${new Date().toLocaleTimeString('en-GB')}</p>
                    </div>
                    <div class="summary">
                        <span>إجمالي المتأخرين: ${late.length}</span>
                        <span>إجمالي المبالغ: ${late.reduce((s,x)=>s+x.remaining, 0).toLocaleString('en-US')} د.ع</span>
                    </div>
                    <table>
                        <thead>
                            <tr>
                                <th>ت</th>
                                <th>اسم الطالب</th>
                                <th>الصف والشعبة</th>
                                <th>إجمالي المطالبة</th>
                                <th>المسدد</th>
                                <th>المتبقي</th>
                                <th>تاريخ آخر دفعة</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${late.map((s, i) => `
                                <tr>
                                    <td>${i+1}</td>
                                    <td style="text-align:right; font-weight:bold;">${s.name}</td>
                                    <td>${s.className}</td>
                                    <td>${s.net.toLocaleString()}</td>
                                    <td style="color:#059669;">${s.paid.toLocaleString()}</td>
                                    <td style="color:#b91c1c; font-weight:bold;">${s.remaining.toLocaleString()}</td>
                                    <td style="font-weight:bold; color:#475569;">${s.lastPayDate}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    <div style="margin-top:50px; display:flex; justify-content:space-between; padding:0 50px;">
                        <div style="text-align:center;"><b>توقيع المحاسب</b><br><br>.....................</div>
                        <div style="text-align:center;"><b>توقيع الإدارة</b><br><br>.....................</div>
                    </div>
                </body>
                </html>
            `);
            win.document.close();
        };

        window.openBulkReminderModal = function() {
            const late = []; 
            const now = new Date(); 
            const instCount = accountantFinance.installmentCount || 5; 
            const g = accountantFinance.globalDates || {};
            const p = accountantFinance.globalPercents || {};
            
            accountantStudents.forEach(s => {
                let paid = (accountantFinance.revenues || []).filter(r => r.studentUid === s.uid).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
                let tuition = (s.finance && s.finance.tuition !== undefined && s.finance.tuition !== "") ? Number(s.finance.tuition) : (Number(accountantFinance.defaults[s.classId]) || 0);
                let transport = Number(s.finance?.transportFee) || 0;
                let discount = Number(s.finance?.discount) || 0;
                let net = tuition + transport - discount;
                let rem = net - paid;
                
                if (rem > 0) {
                    let isLate = false;
                    let accumulatedExpectedPercent = 0;

                    ['inst1', 'inst2', 'inst3', 'inst4', 'inst5'].forEach((k, i) => { 
                        const d = s.finance?.[k] || g[k]; 
                        const percent = p['p' + (i+1)] || (100 / instCount);
                        accumulatedExpectedPercent += percent;

                        if (d && new Date(d) < now && paid < (net * (accumulatedExpectedPercent / 100)) - 100) isLate = true; 
                    });
                    if (isLate) late.push({ ...s, remaining: rem });
                }
            });

            if (late.length === 0) return alert('لا يوجد طلاب متأخرين عن السداد حالياً');

            let html = late.map(s => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom:1px solid #f1f5f9; background:#fff;">
                    <div style="display:flex; align-items:center; gap:12px; flex:1;">
                        <input type="checkbox" class="bulk-remind-check" data-uid="${s.uid}" style="width:20px; height:20px; cursor:pointer;" checked>
                        <div>
                            <div style="font-weight:800; color:#1e293b;">${s.name}</div>
                            <div style="font-size:0.8rem; color:#ef4444; font-weight:bold;">المتبقي: ${s.remaining.toLocaleString()} د.ع</div>
                        </div>
                    </div>
                    <button class="acc-btn-primary" style="background:#25d366; padding:4px 10px; font-size:0.75rem;" onclick="sendWhatsAppReminder('${s.uid}')">
                        <i class="fa-brands fa-whatsapp"></i>
                    </button>
                </div>
            `).join('');

            const m = document.createElement('div');
            m.className = 'acc-modal-overlay';
            m.id = 'bulk-reminder-modal';
            m.style.display = 'flex';
            m.style.alignItems = 'center';
            m.style.justifyContent = 'center';
            m.style.position = 'fixed';
            m.style.top = '0';
            m.style.left = '0';
            m.style.width = '100%';
            m.style.height = '100%';
            m.style.background = 'rgba(0,0,0,0.7)';
            m.style.zIndex = '999999';

            m.innerHTML = `
                <div class="acc-modal-content" style="max-width:550px; width:95%; background:white; padding:0; border-radius:15px; overflow:hidden;">
                    <div style="background:#ef4444; color:white; padding:15px 25px; display:flex; justify-content:space-between; align-items:center;">
                        <h3 style="margin:0;"><i class="fa-solid fa-bullhorn"></i> تنبيه المتأخرين (${late.length})</h3>
                        <i class="fa-solid fa-xmark" style="cursor:pointer; font-size:1.5rem;" onclick="document.getElementById('bulk-reminder-modal').remove()"></i>
                    </div>
                    <div style="padding:15px; background:#fef2f2; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #fee2e2;">
                        <label style="display:flex; align-items:center; gap:8px; font-weight:bold; cursor:pointer; color:#b91c1c;">
                            <input type="checkbox" id="bulk-remind-all" style="width:22px; height:22px;" checked onchange="toggleBulkRemindAll(this.checked)"> تحديد الكل
                        </label>
                        <button class="acc-btn-primary" style="background:#1e3a8a; padding:8px 20px;" onclick="sendBulkRemindersNow()">
                            <i class="fa-solid fa-paper-plane"></i> إرسال للمحددين
                        </button>
                    </div>
                    <div style="max-height:400px; overflow-y:auto; background:#fff;">
                        ${html}
                    </div>
                    <div style="padding:15px; background:#f8fafc; border-top:1px solid #e2e8f0; text-align:center;">
                        <button class="acc-btn-danger" style="width:100%;" onclick="document.getElementById('bulk-reminder-modal').remove()">إغلاق</button>
                    </div>
                </div>
            `;
            document.body.appendChild(m);
        };

        window.toggleBulkRemindAll = function(checked) {
            document.querySelectorAll('.bulk-remind-check').forEach(cb => cb.checked = checked);
        };

        window.sendBulkRemindersNow = function() {
            const selected = Array.from(document.querySelectorAll('.bulk-remind-check:checked')).map(cb => cb.dataset.uid);
            if (selected.length === 0) return alert('يرجى تحديد طالب واحد على الأقل');
            
            if (confirm(`هل أنت متأكد من رغبتك في إرسال ${selected.length} تنبيه واتساب؟\nسيتم فتح النوافذ تباعاً.`)) {
                selected.forEach((uid, index) => {
                    setTimeout(() => {
                        sendWhatsAppReminder(uid);
                    }, index * 1000); // تأخير ثانية بين كل نافذة لتجنب حظر المتصفح
                });
            }
        };



        window.printSalarySlip = function(uid) {
            const u = accountantStaff.find(x => x.uid === uid); if (!u) return;
            const net = (Number(u.payroll?.base)||0) + (Number(u.payroll?.allowance)||0) - (Number(u.payroll?.deduction)||0);
            const win = window.open('', '_blank');
            win.document.write(`<html><body><h2>فيشة راتب: ${u.name}</h2><p>الصافي: ${net.toLocaleString()} د.ع</p><button onclick="window.print()">طباعة</button></body></html>`);
            win.document.close();
        };

        window.calculateNetSalaryLive = function() {
            const b = parseFloat(document.getElementById('acc-hr-base').value) || 0;
            const a = parseFloat(document.getElementById('acc-hr-allowance').value) || 0;
            const d = parseFloat(document.getElementById('acc-hr-deduction').value) || 0;
            const net = (b + a) - d;
            document.getElementById('acc-hr-net-display').innerText = net.toLocaleString() + ' د.ع';
        };

        window.openAccHRManage = function(uid, name, roleAr, base, allowance, deduction, contractStart, contractEnd) {
            document.getElementById('acc-hr-modal-uid').value = uid;
            document.getElementById('acc-hr-modal-name').innerText = `إدارة الراتب: ${name} (${roleAr})`;
            document.getElementById('acc-hr-base').value = base || '';
            document.getElementById('acc-hr-allowance').value = allowance || '';
            document.getElementById('acc-hr-deduction').value = deduction || '';
            document.getElementById('acc-hr-contract-start').value = contractStart || '';
            document.getElementById('acc-hr-contract').value = contractEnd || '';
            calculateNetSalaryLive();
            document.getElementById('acc-modal-overlay').style.display = 'block';
            document.getElementById('acc-hr-modal').style.display = 'block';
        };

        window.printAdmissionApprovalFinal = function() {
            const content = document.getElementById('admission-document-content').innerHTML;
            const win = window.open('', '_blank');
            win.document.write(`<html><head><title>وثيقة قبول</title><link href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&display=swap" rel="stylesheet"><style>body { font-family: 'Amiri', serif; direction: rtl; padding: 20mm; }</style></head><body onload="window.print(); window.close();">${content}</body></html>`);
            win.document.close();
        };

        window.saveAccHRSettings = async function() {
            let uid = document.getElementById('acc-hr-modal-uid').value;
            let b = parseFloat(document.getElementById('acc-hr-base').value) || 0;
            let a = parseFloat(document.getElementById('acc-hr-allowance').value) || 0;
            let d = parseFloat(document.getElementById('acc-hr-deduction').value) || 0;
            let start = document.getElementById('acc-hr-contract-start').value;
            let end = document.getElementById('acc-hr-contract').value;
            try {
                await _restUpdate(`users/${uid}/payroll`, { base: b, allowance: a, deduction: d, contractStart: start, contractEnd: end });
                showCustomAlert('نجاح', 'تم التحديث ✅', 'success');
                loadAccountantData();
                window.closeAllAccModals();
            } catch (err) { alert(err.message); }
        };

        window.payAccSalary = async function() {
            let uid = document.getElementById('acc-hr-modal-uid').value;
            let name = document.getElementById('acc-hr-modal-name').innerText.replace('إدارة الراتب: ', '');
            let b = parseFloat(document.getElementById('acc-hr-base').value) || 0;
            let a = parseFloat(document.getElementById('acc-hr-allowance').value) || 0;
            let d = parseFloat(document.getElementById('acc-hr-deduction').value) || 0;
            let net = (b + a) - d;
            if (confirm(`صرف راتب بقيمة ${net.toLocaleString()} للموظف ${name}؟`)) {
                await window.addAccTransaction('expense', uid, `صرف راتب الموظف ${name}`, net, 'رواتب وأجور');
                loadAccountantData();
                window.closeAllAccModals();
            }
        };

        window.openSalaryStatement = function(uid) {
            console.log("Opening Salary Statement for UID:", uid);
            if (!uid) return;

            const u = accountantStaff.find(x => String(x.uid) === String(uid));
            if (!u) {
                console.error("Staff member not found for salary statement:", uid);
                alert("خطأ: لم يتم العثور على بيانات الموظف.");
                return;
            }

            const start = u.payroll?.contractStart || '2024-09-01';
            const end = u.payroll?.contractEnd || new Date().toISOString().split('T')[0];
            const netMonthly = (Number(u.payroll?.base)||0) + (Number(u.payroll?.allowance)||0) - (Number(u.payroll?.deduction)||0);
            
            const headerElem = document.getElementById('acc-salary-header');
            const bodyElem = document.getElementById('acc-salary-body');
            const modal = document.getElementById('acc-salary-modal');

            if (!headerElem || !bodyElem || !modal) {
                console.error("Salary modal elements missing from DOM");
                return;
            }

            headerElem.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div style="font-size:1.2rem; font-weight:900; color:#1e3a8a;">الموظف: ${u.name}</div>
                        <div style="font-size:0.9rem; color:#64748b; margin-top:4px;">الصافي الشهري المعتمد: <b style="color:#0f172a;">${netMonthly.toLocaleString()} د.ع</b></div>
                    </div>
                    <button class="acc-btn-primary" style="padding:8px 15px; font-size:0.85rem;" onclick="window.printSalarySlip('${uid}')">
                        <i class="fa-solid fa-print"></i> طباعة كشف عام
                    </button>
                </div>`;
            
            let curr = new Date(start); 
            let months = [];
            let stopDate = new Date(end);
            const now = new Date();
            if (stopDate > now) stopDate = now;
            
            // Loop to get up to 24 months
            while(curr <= stopDate) { 
                months.push(new Date(curr)); 
                curr.setMonth(curr.getMonth()+1); 
                if (months.length > 24) break;
            }
            
            const myPayments = (accountantFinance.expenses || []).filter(e => String(e.studentUid) === String(uid) && e.category === 'رواتب وأجور');
            let html = '';
            
            months.reverse().forEach(m => {
                const mStr = m.toLocaleString('ar-IQ', { month: 'long', year: 'numeric' });
                const pay = myPayments.find(p => {
                    const d = new Date(p.timestamp);
                    return d.getMonth() === m.getMonth() && d.getFullYear() === m.getFullYear();
                });
                
                html += `
                    <tr>
                        <td style="font-weight:700; color:#334155;">${mStr}</td>
                        <td style="font-weight:800; color:#0f172a;">${netMonthly.toLocaleString()} <small>د.ع</small></td>
                        <td>
                            ${pay 
                                ? '<span style="color:#059669; font-weight:800; background:#f0fdf4; padding:4px 12px; border-radius:20px; font-size:0.8rem;"><i class="fa-solid fa-check-circle"></i> تم الصرف</span>' 
                                : `<button class="acc-btn-primary" style="padding:5px 15px; font-size:0.8rem; background:#10b981;" onclick="paySalaryForMonth('${uid}', ${m.getTime()}, '${mStr}')">صرف الآن</button>`
                            }
                        </td>
                        <td style="font-size:0.85rem; color:#64748b; font-weight:600;">${pay ? new Date(pay.timestamp).toLocaleDateString('ar-IQ') : '---'}</td>
                        <td style="font-family:monospace; font-size:0.8rem; color:#94a3b8;">${pay ? '#' + pay.id.substring(0,8).toUpperCase() : '---'}</td>
                    </tr>`;
            });
            
            bodyElem.innerHTML = html || '<tr><td colspan="5" style="text-align:center; padding:40px; color:#94a3b8;"><i class="fa-solid fa-circle-info" style="font-size:2rem; display:block; margin-bottom:10px; opacity:0.3;"></i> لا توجد سجلات رواتب متاحة في الفترة المحددة.</td></tr>';
            
            modal.style.display = 'flex';
        };

        window.paySalaryForMonth = async function(uid, time, monthName) {
            const u = accountantStaff.find(x => String(x.uid) === String(uid));
            if (!u) return;
            const net = (Number(u.payroll?.base)||0) + (Number(u.payroll?.allowance)||0) - (Number(u.payroll?.deduction)||0);
            
            if (confirm(`هل تريد صرف راتب شهر (${monthName}) للموظف ${u.name} بقيمة ${net.toLocaleString()} د.ع؟`)) {
                try {
                    // Correctly passing the historical timestamp as the manualDate argument (9th argument)
                    await window.addAccTransaction('expense', uid, `صرف راتب شهر ${monthName} للموظف ${u.name}`, net, 'رواتب وأجور', '-', 'نقداً', '-', time);
                    showCustomAlert('تم الصرف', `تم تسجيل صرف راتب شهر ${monthName} بنجاح.`, 'success');
                    window.openSalaryStatement(uid); 
                } catch (err) {
                    alert("خطأ أثناء الصرف: " + err.message);
                }
            }
        };

        window.saveGlobalFinancialSettings = function() {
            const count = Number(document.getElementById('acc-setting-inst-count').value) || 5;
            const dates = {};
            const percents = {};
            let totalP = 0;

            for (let i = 1; i <= 5; i++) {
                dates['inst' + i] = document.getElementById('acc-global-inst' + i).value;
                const valP = parseInt(document.getElementById('acc-global-p' + i).value) || 0;
                percents['p' + i] = valP;
                if (i <= count) totalP += valP;
            }

            if (totalP > 0 && totalP !== 100) {
                if(!confirm(`مجموع النسب الحالية هو ${totalP}%. يفضل أن يكون المجموع 100% لضمان دقة الحسابات. هل تود الحفظ على أي حال؟`)) return;
            }

            const branchId = currentUser?.branchId || 'samawah';
            Promise.all([
                _restSet(`financialSettings/branches/${branchId}/installmentCount`, count),
                _restSet(`financialSettings/branches/${branchId}/globalDates`, dates),
                _restSet(`financialSettings/branches/${branchId}/globalPercents`, percents)
            ]).then(() => {
                showCustomAlert('تم الحفظ', '✅ تم حفظ المواعيد والنسب للفرع الحالي بنجاح', 'success');
                loadAccountantData();
            }).catch(e => alert('خطأ في الحفظ: ' + e.message));
        };

        window.saveGlobalInstCount = function() {
            const count = Number(document.getElementById('acc-setting-inst-count').value) || 5;
            const branchId = currentUser?.branchId || 'samawah';
            _restSet(`financialSettings/branches/${branchId}/installmentCount`, count).then(() => {
                accountantFinance.installmentCount = count;
                alert('✅ تم تحديث عدد الأقساط للفرع الحالي');
                loadAccountantData();
            }).catch(e => alert('خطأ: ' + e.message));
        };


        
        window.shareReceiptWhatsApp = function(uid) {
            const s = accountantStudents.find(x => x.uid === uid);
            if (!s || !s.phone) return alert('خطأ: لا يوجد رقم هاتف مسجل لهذا الطالب');
            
            const myRevs = accountantFinance.revenues.filter(r => r.studentUid === uid).sort((a,b) => b.timestamp - a.timestamp);
            if (myRevs.length === 0) return alert('لا توجد دفعات لمشاركتها');
            
            const last = myRevs[0];
            const msg = `تحية طيبة من إدارة مدرسة النهرين الأهلية.\nتم استلام مبلغ (${Number(last.amount).toLocaleString()} د.ع) كقسط للطالب (${s.name}).\nالتاريخ: ${new Date(last.timestamp).toLocaleDateString('ar-IQ')}\nشكراً لتعاونكم.`;
            const url = `https://wa.me/964${s.phone.replace(/^0/, '')}?text=${encodeURIComponent(msg)}`;
            window.open(url, '_blank');
        };

        window.openAccStudentPayment = function(uid) {

            if (!uid) return;

            const s = accountantStudents.find(x => String(x.uid) === String(uid));
            if (!s) {
                alert('خطأ: لم يتم العثور على بيانات الطالب في القائمة الحالية.');
                return;
            }

            const modal = document.getElementById('acc-payment-modal');
            const overlay = document.getElementById('acc-modal-overlay');

            if (!modal || !overlay) {
                alert("خطأ تقني: تعذر العثور على نافذة التسديد في الصفحة.");
                return;
            }

            if (modal.parentElement !== document.body) {
                document.body.appendChild(modal);
                document.body.appendChild(overlay);
            }

            // Populate data
            document.getElementById('acc-payment-uid').value = s.uid;
            document.getElementById('acc-payment-name').value = s.name;
            document.getElementById('acc-payment-modal-title').innerText = 'استلام مبلغ من: ' + s.name;
            document.getElementById('acc-payment-amount').value = '';
            document.getElementById('acc-payment-note').value = 'تسديد قسط الطالب ' + s.name;
            document.getElementById('acc-payment-next-date').value = '';
            
            // Force Visibility with high z-index and !important
            overlay.style.setProperty('display', 'block', 'important');
            overlay.style.setProperty('z-index', '200000', 'important');
            overlay.style.setProperty('position', 'fixed', 'important');
            
            modal.style.setProperty('display', 'block', 'important');
            modal.style.setProperty('z-index', '200001', 'important');
            modal.style.setProperty('position', 'fixed', 'important');
        };

        window.deleteAccTransaction = async function(id, type) {
            const confirmed = await showAccConfirm('تأكيد الحذف', 'هل أنت متأكد من حذف هذا السند نهائياً؟ سيؤثر ذلك على الرصيد الكلي ولا يمكن التراجع عنه.');
            if (!confirmed) return;

            try {
                const refPath = `finance/${type}s/${id}`;
                const snap = await _restGet(refPath);
                const data = snap.val();
                
                let qs = '';
                try { const u = firebase.auth().currentUser; if (u) qs = '?auth=' + await u.getIdToken(); } catch(_) {}
                const delRes = await fetch(`${firebaseConfig.databaseURL}/${refPath}.json${qs}`, { method: 'DELETE' });
                if (!delRes.ok) throw new Error('HTTP ' + delRes.status);
                
                if (window.addAccAuditLog && data) {
                    const action = type === 'revenue' ? 'حذف إيراد' : 'حذف مصروف';
                    const amountText = Number(data.amount || 0).toLocaleString();
                    window.addAccAuditLog(action, `تم حذف سند رقم ${id.substring(0,6).toUpperCase()} بقيمة ${amountText} د.ع - التفاصيل: ${data.note}`, Number(data.amount) || 0);
                }

                showCustomAlert('تم الحذف', 'تم حذف السند وإلغاء العملية من السجلات بنجاح.', 'success');
                loadAccountantData();
            } catch (e) {
                alert('خطأ أثناء عملية الحذف: ' + e.message);
            }
        };

        function sendWhatsAppReminder(uid) {
            const s = accountantStudents.find(x => x.uid === uid);
            if (!s) return;
            const phone = (s.phone || '').toString().replace(/\s/g, '');
            if (!phone || phone.length < 8) { alert('رقم الهاتف غير متوفر لهذا الطالب.'); return; }
            let paid = 0;
            if (accountantFinance.revenues)
                paid = accountantFinance.revenues.filter(r => r.studentUid === uid).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
            const tuition = (s.finance && s.finance.tuition !== undefined && s.finance.tuition !== '')
                ? Number(s.finance.tuition) : (Number(accountantFinance.defaults[s.classId]) || 0);
            const remaining = (tuition + (Number(s.finance?.transportFee) || 0) - (Number(s.finance?.discount) || 0)) - paid;
            let fp = phone.startsWith('0') ? '964' + phone.substring(1) : phone;
            if (!fp.startsWith('964')) fp = '964' + fp;
            const msg = 'عزيزي ولي أمر الطالب (' + s.name + ')، المتبقي من القسط: (' + remaining.toLocaleString() + ' د.ع). نرجو المراجعة. مدرسة النهرين الأهلية.';
            window.open('https://wa.me/' + fp + '?text=' + encodeURIComponent(msg), '_blank');
        }

        window.printAdmissionApprovalUID = function(uid) {
            const s = accountantStudents.find(x => String(x.uid) === String(uid));
            if (!s) return alert('خطأ: تعذر العثور على بيانات الطالب');
            
            const userBranchId = currentUser ? currentUser.branchId : 'samawah';
            const branch = (window.NAHRAIN_BRANCHES && window.NAHRAIN_BRANCHES[userBranchId]) ? window.NAHRAIN_BRANCHES[userBranchId] : { name: 'مدرسة النهرين الأهلية', logo: '' };
            const dateStr = new Date().toLocaleDateString('ar-IQ');
            const academicYear = window.currentAcademicYear || "2024 / 2025";

            const docContent = `
                <style>
                    @media print {
                        @page { size: A4; margin: 0; }
                        body { margin: 0; padding: 0; }
                        .admission-print-container { width: 210mm !important; height: 297mm !important; padding: 20mm !important; border: none !important; box-shadow: none !important; }
                        .no-print { display: none !important; }
                    }
                </style>
                <div class="admission-print-container" style="padding:20mm; background:white; color:#000; width:210mm; height:297mm; margin:0 auto; font-family:'Amiri', serif; position:relative; box-sizing:border-box; border:1px solid #ddd; box-shadow:0 0 20px rgba(0,0,0,0.1);">
                    <div style="background:#fff3cd; color:#856404; padding:10px; text-align:center; margin-bottom:20px; font-size:1rem; border-radius:5px; font-family:sans-serif;" class="no-print">
                        💡 يمكنك التعديل على النص مباشرة بالضغط عليه (للطباعة اضغط الزر الأزرق في الأعلى)
                    </div>
                    
                    <!-- Official Header -->
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:40px; border-bottom:3px solid #1e3a8a; padding-bottom:25px;">
                        <div style="text-align:left; font-size:1.1rem; font-family:sans-serif; width:35%; line-height:1.4;" contenteditable="true">
                            Ministry Of Education<br>
                            Directorate Of Education In AlMuthanna<br>
                            Al-Nahrain Private School
                        </div>
                        <div style="text-align:center; width:30%;">
                            <img src="${branch.logo}" style="height:110px; margin-bottom:10px;"><br>
                            <b style="font-size:1.3rem; color:#1e3a8a; line-height:1.2;" contenteditable="true">إعدادية النهرين<br>المهنية الأهلية</b>
                        </div>
                        <div style="text-align:right; font-size:1.2rem; width:35%; line-height:1.6;" contenteditable="true">
                            المديرية العامة لتربية المثنى<br>
                            إعدادية النهرين المهنية الأهلية
                        </div>
                    </div>

                    <!-- Metadata Box -->
                    <div style="display:flex; justify-content:space-between; margin-bottom:50px; font-size:1.3rem;">
                        <div style="text-align:right;">
                            <div>العدد : <span contenteditable="true">....................</span></div>
                            <div>التاريخ : <b contenteditable="true">${dateStr}</b></div>
                        </div>
                        <div style="text-align:left; font-weight:bold;">
                            إلى / <span contenteditable="true">....................................</span>
                        </div>
                    </div>

                    <!-- Subject Title -->
                    <div style="text-align:center; margin-bottom:60px;">
                        <h2 style="text-decoration:underline; font-size:2.4rem; font-weight:900;" contenteditable="true">م / استمارة قبول طالب</h2>
                    </div>

                    <!-- Formal Body Text -->
                    <div style="font-size:1.7rem; line-height:2.8; text-align:justify; padding:0 30px;" contenteditable="true">
                        لا مانع لدينا من قبول الطالب / ة ( <b style="font-size:1.9rem; border-bottom:2px solid #000; padding:0 15px;">${s.name}</b> ) في الصف ( <b style="font-size:1.7rem;">${getClassName(s.classId)}</b> ) في مدرستنا للعام الدراسي ( <b style="font-size:1.7rem;">${academicYear}</b> ) بعد تزويده بالوثيقة المدرسية والبطاقة المدرسية مع درجات السنوات السابقة، هذا وتشيد مدرستنا بجهودكم للنهوض بواقع العملية التربوية لعراقنا الحبيب .
                    </div>

                    <div style="text-align:center; margin-top:60px; font-size:1.7rem; font-weight:bold;" contenteditable="true">
                        مع الشكر والتقدير .........
                    </div>

                    <!-- Signature Area -->
                    <div style="position:absolute; bottom:150px; right:60px; text-align:right;">
                        <div style="text-align:center; width:280px; border:2px solid #1e3a8a; padding:20px; border-radius:12px; background:#f8fafc;">
                            <b style="font-size:1.5rem;" contenteditable="true">فؤاد هادي علوان</b><br>
                            <b style="font-size:1.3rem;" contenteditable="true">مدير المدرسة</b><br>
                            <div style="margin-top:50px; border-top:1px dashed #333; width:180px; margin-left:auto; margin-right:auto;">التوقيع</div>
                        </div>
                    </div>

                    <!-- Footer Notice -->
                    <div style="position:absolute; bottom:40px; width:100%; text-align:center; left:0; font-size:1rem; color:#666; border-top:1px solid #eee; padding-top:15px;" contenteditable="true">
                        مدرسة النهرين الأهلية - قسم شؤون الطلاب والقبول المركزي
                    </div>
                </div>
            `;

            document.getElementById('admission-document-content').innerHTML = docContent;
            document.getElementById('acc-modal-overlay').style.display = 'block';
            document.getElementById('admission-approval-modal').style.display = 'flex';
        };

        window.printStudentReceiptFromUID = async function(uid) {
            let s = (window.accountantStudents || []).find(x => String(x.uid) === String(uid));
            
            if (!s) {
                // Try to fetch directly from Firebase if not in local cache
                try {
                    const snap = await _restGet('users/' + uid);
                    s = snap.val();
                    if (s) s.uid = uid;
                } catch (e) { console.error("Firebase fetch error:", e); }
            }

            if (!s) return alert('خطأ: تعذر العثور على بيانات الطالب');
            
            let dept = "-", stage = "-", section = "-";
            if (s.classId && s.classId.includes('_')) {
                const parts = s.classId.split('_');
                if (parts.length >= 3) {
                    dept = parts[0];
                    stage = parts[1];
                    section = parts[2];
                    if (window.NAHRAIN_DEPARTMENTS && window.NAHRAIN_DEPARTMENTS[dept]) dept = window.NAHRAIN_DEPARTMENTS[dept].name;
                    if (window.NAHRAIN_STAGES && window.NAHRAIN_STAGES[stage]) stage = window.NAHRAIN_STAGES[stage].name;
                }
            } else {
                dept = getClassName(s.classId);
            }

            printStudentReceipt({
                name: s.name,
                deptName: dept,
                stageName: stage,
                sectionName: section,
                documentStatus: s.documentStatus || "تم الجلب",
                loginCode: s.loginCode || "---",
                password: null,
                phone: s.phone || "---"
            });
        };
        // ================== NOTIFICATION SYSTEM (Telegram & WhatsApp) ==================
        async function broadcastNotification(message) {
            // 1. Telegram (Restored)
            sendTelegramNotification(message);
            // 2. WhatsApp (Via CallMeBot)
            sendWhatsAppNotification(message);
        }

        async function sendTelegramNotification(message) {
            // Token & chatIds loaded from Firebase — not hardcoded in source
            try {
                const snap = await _restGet('schoolDB/notifConfig');
                const cfg = snap.val();
                if (!cfg || !cfg.botToken || !cfg.chatIds) return;
                const chatIds = Array.isArray(cfg.chatIds) ? cfg.chatIds : [cfg.chatIds];
                for (const chatId of chatIds) {
                    const url = `https://api.telegram.org/bot${cfg.botToken}/sendMessage`;
                    try {
                        await fetch(url, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' })
                        });
                    } catch (e) { console.error("Telegram Notification Error:", e); }
                }
            } catch(e) { console.error("Failed to load notif config:", e); }
        }

        async function sendWhatsAppNotification(message) {
            // To enable WhatsApp, set your phone and apikey from CallMeBot.com
            // Step 1: Add +34 621 07 30 12 to your contacts
            // Step 2: Send "I allow callmebot to send me messages"
            // Step 3: Put the API Key you receive below:
            const phone = "9647889556566"; 
            const apikey = ""; // <--- ضغ كود الـ API هنا عند استلامه
            if(!phone || !apikey) return;

            const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodeURIComponent(message.replace(/<[^>]*>/g, ''))}&apikey=${apikey}`;
            try {
                await fetch(url, { mode: 'no-cors' }); 
            } catch (e) { console.error("WhatsApp Notification Error:", e); }
        }

        // --- GLOBAL SMART SEARCH LOGIC ---
        window.performGlobalSearch = function (query) {
            const resultsDiv = document.getElementById('acc-search-results');
            if (!query || query.length < 2) {
                resultsDiv.style.display = 'none';
                return;
            }

            const q = query.toLowerCase();
            let html = '';

            // 1. Search Students
            const foundStudents = (accountantStudents || []).filter(s =>
                (s.name && s.name.toLowerCase().includes(q)) ||
                (s.uid && s.uid.toLowerCase().includes(q))
            ).slice(0, 5);

            if (foundStudents.length > 0) {
                html += `<div class="search-result-group">
                    <div class="search-result-group-title"><i class="fa-solid fa-user-graduate"></i> الطلاب</div>`;
                foundStudents.forEach(s => {
                    html += `
                    <div class="search-result-item" onclick="goToAccSearchResult('student', '${s.uid}')">
                        <div class="search-result-info">
                            <span class="title">${s.name}</span>
                            <span class="subtitle">طالب - ${getClassName(s.classId)}</span>
                        </div>
                        <i class="fa-solid fa-chevron-left" style="color:#cbd5e1;"></i>
                    </div>`;
                });
                html += `</div>`;
            }

            // 2. Search Revenues
            const foundRevs = (accountantFinance.revenues || []).filter(r =>
                (r.id && r.id.toLowerCase().includes(q)) ||
                (r.note && r.note.toLowerCase().includes(q)) ||
                (r.amount && r.amount.toString().includes(q))
            ).slice(0, 5);

            if (foundRevs.length > 0) {
                html += `<div class="search-result-group">
                    <div class="search-result-group-title"><i class="fa-solid fa-receipt"></i> المقبوضات (سندات القبض)</div>`;
                foundRevs.forEach(r => {
                    html += `
                    <div class="search-result-item" onclick="goToAccSearchResult('revenue', '${r.id}')">
                        <div class="search-result-info">
                            <span class="title">${r.note || 'وصل قبض'}</span>
                            <span class="subtitle">رقم: ${r.id.substring(0, 8).toUpperCase()} - ${new Date(r.timestamp).toLocaleDateString('ar-IQ')}</span>
                        </div>
                        <span class="search-result-amount">${Number(r.amount).toLocaleString()} د.ع</span>
                    </div>`;
                });
                html += `</div>`;
            }

            // 3. Search Expenses
            const foundExps = (accountantFinance.expenses || []).filter(e =>
                (e.id && e.id.toLowerCase().includes(q)) ||
                (e.note && e.note.toLowerCase().includes(q)) ||
                (e.category && e.category.toLowerCase().includes(q)) ||
                (e.amount && e.amount.toString().includes(q))
            ).slice(0, 5);

            if (foundExps.length > 0) {
                html += `<div class="search-result-group">
                    <div class="search-result-group-title"><i class="fa-solid fa-money-bill-transfer"></i> المصروفات (سندات الصرف)</div>`;
                foundExps.forEach(e => {
                    html += `
                    <div class="search-result-item" onclick="goToAccSearchResult('expense', '${e.id}')">
                        <div class="search-result-info">
                            <span class="title">${e.note || 'سند صرف'}</span>
                            <span class="subtitle">${e.category || 'أخرى'} - ${new Date(e.timestamp).toLocaleDateString('ar-IQ')}</span>
                        </div>
                        <span class="search-result-amount expense">➖ ${Number(e.amount).toLocaleString()} د.ع</span>
                    </div>`;
                });
                html += `</div>`;
            }

            if (!html) {
                html = `<div class="no-results">🔍 لا توجد نتائج تطابق بحثك في النظام المالي...</div>`;
            }

            resultsDiv.innerHTML = html;
            resultsDiv.style.display = 'block';
        };

        window.goToAccSearchResult = function (type, id) {
            // Close the search dropdown first
            const resBox = document.getElementById('acc-search-results');
            const inBox  = document.getElementById('acc-global-search-input');
            if (resBox) resBox.style.display = 'none';
            if (inBox)  inBox.value = '';

            if (type === 'student') {
                // Open the financial statement (كشف الحساب) directly — it already exists
                if (typeof window.openAccStudentStatement === 'function') {
                    window.openAccStudentStatement(id);
                }
            } else if (type === 'revenue') {
                switchAccTab('revenues');
            } else if (type === 'expense') {
                switchAccTab('expenses');
            }
        };

        // --- TRANSACTION EDIT LOGIC ---
        window.openAccEditTransaction = function(id, type, amount, note) {
            document.getElementById('edit-tx-id').value = id;
            document.getElementById('edit-tx-type').value = type;
            document.getElementById('edit-tx-amount').value = amount;
            document.getElementById('edit-tx-note').value = note;
            document.getElementById('acc-modal-overlay').style.display = 'block';
            document.getElementById('acc-edit-transaction-modal').style.display = 'block';
        };

        // Safe dispatchers — avoid injecting data into onclick attributes
        window._openRevEdit = function(id) {
            const r = window._revCache && window._revCache[id];
            if (!r) return;
            window.openAccEditTransaction(r.id, 'revenue', r.amount, r.note || '');
        };
        window._printRev = function(id) {
            const r = window._revCache && window._revCache[id];
            if (!r) return;
            const dateStr = new Date(r.timestamp).toLocaleString('en-US');
            window.printAccReceipt(r.id, 'revenue', r.amount, r.note || '', dateStr, 'مقبوضات عامة', r.studentUid || '');
        };
        window._openExpEdit = function(id) {
            const e = window._expCache && window._expCache[id];
            if (!e) return;
            window.openAccEditTransaction(e.id, 'expense', e.amount, e.note || '');
        };
        window._printExp = function(id) {
            const e = window._expCache && window._expCache[id];
            if (!e) return;
            const dateStr = new Date(e.timestamp).toLocaleString('en-US');
            window.printAccReceipt(e.id, 'expense', e.amount, e.note || '', dateStr, e.category || '', '', '', e.payee || '', e.method || 'نقداً', e.refNum || '');
        };

        window.saveEditedTransaction = async function() {
            const id = document.getElementById('edit-tx-id').value;
            const type = document.getElementById('edit-tx-type').value;
            const amount = Number(document.getElementById('edit-tx-amount').value) || 0;
            const note = document.getElementById('edit-tx-note').value;
            
            if (amount <= 0 || !note.trim()) return alert("بيانات غير صالحة");
            
            try {
                await _restUpdate(`finance/${type}s/${id}`, { amount, note });
                showCustomAlert('تم التعديل', 'تم تحديث بيانات السند بنجاح', 'success');
                window.closeAllAccModals();
                loadAccountantData();
            } catch (e) { alert(e.message); }
        };

        window.removeExpenseCategory = async function(cat) {
            if (!confirm(`هل أنت متأكد من حذف التصنيف (${cat})؟`)) return;
            accountantFinance.expenseCategories = accountantFinance.expenseCategories.filter(c => c !== cat);
            try {
                await _restSet('financialSettings/expenseCategories', accountantFinance.expenseCategories);
                loadAccountantData();
            } catch (e) { alert(e.message); }
        };

        window.addExpenseCategory = async function() {
            const input = document.getElementById('acc-new-category');
            let cat = input ? input.value.trim() : '';
            
            if (!cat) {
                cat = prompt("أدخل اسم التصنيف الجديد:");
            }
            
            if (!cat || cat.trim() === "") return;
            if (accountantFinance.expenseCategories.includes(cat)) return showCustomAlert('تنبيه', "هذا التصنيف موجود بالفعل", 'warning');
            
            accountantFinance.expenseCategories.push(cat);
            try {
                await _restSet('financialSettings/expenseCategories', accountantFinance.expenseCategories);
                if (input) input.value = '';
                loadAccountantData();
                showCustomAlert('تمت الإضافة', `تمت إضافة التصنيف (${cat}) بنجاح ✅`, 'success');
            } catch (e) { alert(e.message); }
        };

        // --- SEQUENTIAL RECEIPT NUMBERING ---
        // Uses REST read-increment-write (WebSocket transactions hang on this network).
        // Not fully atomic, but safe for a single-accountant workflow.
        async function _nextReceiptNum(branchId, type) {
            const prefix = type === 'revenue' ? 'RV' : 'EX';
            const year = new Date().getFullYear();
            const path = `financialSettings/branches/${branchId}/lastReceiptNum/${prefix}`;
            const snap = await _restGet(path);
            const newNum = (Number(snap.val()) || 0) + 1;
            let qs = '';
            try {
                const u = firebase.auth().currentUser;
                if (u) qs = '?auth=' + await u.getIdToken();
            } catch (_) {}
            await fetch(`${firebaseConfig.databaseURL}/${path}.json${qs}`, {
                method: 'PUT',
                body: JSON.stringify(newNum)
            });
            return `${prefix}-${year}-${String(newNum).padStart(5, '0')}`;
        }

        // --- CORE TRANSACTION LOGIC ---
        window.addAccTransaction = async function (type, studentUid, note, amount, category, payee = '', method = 'نقداً', refNum = '', manualDate = null) {
            if (!amount || amount <= 0) {
                alert('يرجى إدخال مبلغ صحيح');
                return null;
            }
            const userBranchId = currentUser ? currentUser.branchId : 'samawah';
            const timestamp = manualDate ? new Date(manualDate).getTime() : Date.now();
            const receiptNum = await _nextReceiptNum(userBranchId, type);
            const numericId = Date.now().toString().slice(-8) + Math.floor(Math.random() * 100).toString().padStart(2, '0');
            const data = {
                id: numericId,
                receiptNum,
                amount,
                note,
                payee: payee || '-',
                method: method || 'نقداً',
                refNum: refNum || '-',
                category: category || 'أخرى',
                timestamp,
                addedBy: currentUser?.name || 'محاسب',
                branchId: userBranchId,
                studentUid: studentUid || null
            };

            try {
                await _restSet(`finance/${type}s/${numericId}`, data);

                // Audit Log (fire-and-forget)
                _restPush('finance/auditLogs', {
                    action: type === 'revenue' ? 'قيد قبض' : 'قيد صرف',
                    amount,
                    note,
                    timestamp: Date.now(),
                    user: currentUser?.name || 'محاسب',
                    branchId: userBranchId
                }).catch(() => {});

                // Notifications
                const emoji = type === 'revenue' ? '📈' : '📉';
                const typeLabel = type === 'revenue' ? 'مقبوضات' : 'مصروفات';
                broadcastNotification(`${emoji} <b>تنبيه حركة مالية جديدة</b>\nالفرع: ${userBranchId}\nالنوع: ${typeLabel}\nالمبلغ: ${Number(amount).toLocaleString()} د.ع\nالبيان: ${note}\nالمستخدم: ${currentUser?.name || 'محاسب'}`);

                return numericId;
            } catch (e) {
                console.error('Database Error:', e);
                alert('خطأ في قاعدة البيانات: ' + e.message);
                throw e;
            }
        };

        window.submitAccRevenue = async function () {
            const amount = Number(document.getElementById('acc-rev-amount').value) || 0;
            const note = document.getElementById('acc-rev-note').value;
            if (amount <= 0) return alert('يرجى إدخال المبلغ');
            if (!note) return alert('يرجى إدخال البيان');

            try {
                const txId = await window.addAccTransaction('revenue', null, note, amount, 'إيرادات عامة');
                showCustomAlert('تم الحفظ', 'تم تسجيل الإيراد بنجاح ✅', 'success');
                document.getElementById('acc-rev-amount').value = '';
                document.getElementById('acc-rev-note').value = '';
                loadAccountantData();
            } catch (e) { console.error(e); }
        };

        window.submitAccExpense = async function () {
            const amount = Number(document.getElementById('acc-exp-amount').value) || 0;
            const note = document.getElementById('acc-exp-note').value;
            const payee = document.getElementById('acc-exp-payee').value;
            const category = document.getElementById('acc-exp-category').value;
            const method = document.getElementById('acc-exp-method').value;
            const refNum = document.getElementById('acc-exp-ref').value;
            const manualDate = document.getElementById('acc-exp-manual-date').value;
            
            if (amount <= 0) return alert('يرجى إدخال مبلغ صحيح');
            if (!note) return alert('يرجى إدخال البيان');

            try {
                const txId = await window.addAccTransaction('expense', null, note, amount, category, payee, method, refNum, manualDate);
                showCustomAlert('تم الحفظ', 'تم تسجيل سند الصرف بنجاح ✅', 'success');
                
                // Clear inputs
                document.getElementById('acc-exp-amount').value = '';
                document.getElementById('acc-exp-note').value = '';
                document.getElementById('acc-exp-payee').value = '';
                document.getElementById('acc-exp-ref').value = '';
                
                loadAccountantData();
                
                if (confirm('هل تريد طباعة سند الصرف الآن؟')) {
                    const dateStr = manualDate ? new Date(manualDate).toLocaleString('ar-IQ') : new Date().toLocaleString('ar-IQ');
                    window.printAccReceipt(txId, 'expense', amount, note, dateStr, category, '', '', payee, method, refNum);
                }
            } catch (e) { console.error(e); }
        };

        window.submitAccStudentPayment = async function () {
            const uid = document.getElementById('acc-payment-uid').value;
            const amountStr = document.getElementById('acc-payment-amount').value;
            const amount = Number(amountStr.replace(/,/g, ''));
            const note = document.getElementById('acc-payment-note').value;
            const nextDueDate = document.getElementById('acc-payment-next-date').value;

            if (amount <= 0) return alert('يرجى إدخال مبلغ صحيح');

            const btn = document.querySelector('#acc-payment-modal .acc-btn-primary');
            if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري الحفظ...'; }

            try {
                const txId = await window.addAccTransaction('revenue', uid, note, amount, 'أقساط طلاب');

                if (nextDueDate) {
                    await _restSet(`users/${uid}/finance/nextDueDate`, nextDueDate);
                }

                window.closeAllAccModals();
                showCustomAlert('تم التسديد', 'تم استلام المبلغ بنجاح ✅', 'success');
                loadAccountantData();

                setTimeout(() => {
                    window.printAccReceipt(txId, 'revenue', amount, note, new Date().toLocaleString('ar-IQ'), 'أقساط طلاب', uid, nextDueDate);
                }, 500);
            } catch (e) {
                console.error(e);
                if (btn) { btn.disabled = false; btn.textContent = 'تأكيد عملية التسديد وطباعة الوصل 🖨️'; }
            }
        };

        // --- EXPORT TO CSV ---
        window.exportAccToCSV = function(type) {
            const isRev = type === 'revenue';
            const rawData = isRev ? accountantFinance.revenues : accountantFinance.expenses;
            if (!rawData || rawData.length === 0) return alert('لا توجد بيانات للتصدير');

            const sorted = [...rawData].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            const headers = isRev
                ? ['رقم الوصل', 'التاريخ', 'البيان', 'المبلغ (د.ع)', 'طريقة الدفع', 'الطالب', 'اسم الشعبة', 'بواسطة']
                : ['رقم السند', 'التاريخ', 'التصنيف', 'يصرف للجهة', 'البيان', 'المبلغ (د.ع)', 'طريقة الدفع', 'رقم المرجع', 'بواسطة'];

            const rows = sorted.map(r => {
                if (isRev) {
                    const st = accountantStudents.find(s => s.uid === r.studentUid);
                    return [
                        r.receiptNum || '-',
                        new Date(r.timestamp).toLocaleDateString('ar-IQ'),
                        r.note || '-',
                        r.amount || 0,
                        r.method || 'نقداً',
                        st ? st.name : '-',
                        st ? getClassName(st.classId) : '-',
                        r.addedBy || '-'
                    ];
                } else {
                    return [
                        r.receiptNum || '-',
                        new Date(r.timestamp).toLocaleDateString('ar-IQ'),
                        r.category || '-',
                        r.payee || '-',
                        r.note || '-',
                        r.amount || 0,
                        r.method || 'نقداً',
                        r.refNum || '-',
                        r.addedBy || '-'
                    ];
                }
            });

            const csvContent = '﻿' + [headers, ...rows]
                .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
                .join('\n');

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const label = isRev ? 'مقبوضات' : 'مصروفات';
            a.download = `${label}_${window.currentAcademicYear.replace(/\s\/\s/g, '-')}_${new Date().toLocaleDateString('ar-IQ').replace(/\//g, '-')}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        };

        // --- PAYMENT METHOD BREAKDOWN ---
        function updateMethodBreakdown() {
            const container = document.getElementById('acc-method-breakdown');
            if (!container) return;

            const methodMap = {};
            (accountantFinance.revenues || []).forEach(r => {
                const m = r.method || 'نقداً';
                if (!methodMap[m]) methodMap[m] = { count: 0, total: 0 };
                methodMap[m].count++;
                methodMap[m].total += Number(r.amount) || 0;
            });

            const methodColors = {
                'نقداً':           { bg: '#f0fdf4', border: '#22c55e', icon: 'fa-money-bill-wave', color: '#166534' },
                'تحويل بنكي':      { bg: '#eff6ff', border: '#3b82f6', icon: 'fa-building-columns', color: '#1e40af' },
                'حوالة':           { bg: '#faf5ff', border: '#a855f7', icon: 'fa-paper-plane', color: '#6b21a8' },
                'شيك':             { bg: '#fff7ed', border: '#f97316', icon: 'fa-money-check', color: '#9a3412' },
            };

            if (Object.keys(methodMap).length === 0) {
                container.innerHTML = '<p style="color:#94a3b8; font-size:0.85rem;">لا توجد بيانات.</p>';
                return;
            }

            container.innerHTML = Object.entries(methodMap).map(([method, stats]) => {
                const c = methodColors[method] || { bg: '#f8fafc', border: '#cbd5e1', icon: 'fa-receipt', color: '#475569' };
                return `
                <div style="background:${c.bg}; border:2px solid ${c.border}; border-radius:12px; padding:14px; text-align:center;">
                    <i class="fa-solid ${c.icon}" style="font-size:1.5rem; color:${c.color}; margin-bottom:8px; display:block;"></i>
                    <div style="font-weight:900; font-size:0.85rem; color:${c.color};">${escHtml(method)}</div>
                    <div style="font-size:1.1rem; font-weight:800; color:#1e293b; margin:6px 0;">${stats.total.toLocaleString()} <span style="font-size:0.7rem;">د.ع</span></div>
                    <div style="font-size:0.75rem; color:#64748b;">${stats.count} معاملة</div>
                </div>`;
            }).join('');
        }

        // --- DELETE TRANSACTION LOGIC --- (defined as window.deleteAccTransaction above)

        function showAccConfirm(title, msg) {
            return new Promise((resolve) => {
                showUnifiedModal({
                    title: title,
                    msg: msg,
                    icon: 'fa-triangle-exclamation',
                    iconColor: '#f59e0b',
                    type: 'confirm',
                    onComplete: (res) => resolve(res)
                });
            });
        }

        // --- NEW: PRINT SALARY SLIP (A4) ---
        window.printSalarySlip = function(uid) {
            const u = accountantStaff.find(x => x.uid === uid);
            if (!u) return;

            const bId = currentUser?.branchId || 'samawah';
            const branch = window.NAHRAIN_BRANCHES[bId] || { name: 'مدرسة النهرين', logo: 'logo.jpg' };
            
            const base = Number(u.payroll?.base) || 0;
            const allowance = Number(u.payroll?.allowance) || 0;
            const deduction = Number(u.payroll?.deduction) || 0;
            const netSalary = (base + allowance) - deduction;
            
            const roleAr = u.role === 'teacher' ? 'مدرس' : (u.role === 'admin' ? 'إداري' : (u.role === 'accountant' ? 'محاسب' : 'موظف'));

            const printWindow = window.open('', '_blank');
            printWindow.document.write(`
                <html>
                <head>
                    <title>فيشة راتب - ${u.name}</title>
                    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;800&display=swap" rel="stylesheet">
                    <style>
                        body { font-family: 'Cairo', sans-serif; direction: rtl; padding: 40px; color: #1e293b; background: #fff; }
                        .voucher { max-width: 800px; margin: auto; border: 2px solid #334155; padding: 30px; border-radius: 20px; position: relative; min-height: 500px; }
                        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #334155; padding-bottom: 15px; margin-bottom: 20px; }
                        .header img { height: 80px; }
                        .title-box { text-align: center; margin-bottom: 25px; }
                        .title-box h2 { display: inline-block; border: 2px solid #334155; padding: 5px 40px; border-radius: 50px; font-size: 1.2rem; background: #f8fafc; }
                        
                        .info-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
                        .info-item { border-bottom: 1px dashed #e2e8f0; padding: 8px 0; display: flex; justify-content: space-between; }
                        .info-item b { color: #475569; }
                        
                        .salary-details { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; margin-top: 30px; }
                        .salary-box { border: 1px solid #cbd5e1; padding: 15px; border-radius: 12px; text-align: center; }
                        .salary-box span { display: block; font-size: 0.8rem; color: #64748b; margin-bottom: 5px; }
                        .salary-box b { font-size: 1.2rem; }
                        
                        .net-salary { grid-column: span 3; background: #1e293b; color: #fff; padding: 20px; border-radius: 12px; margin-top: 10px; display: flex; justify-content: space-between; align-items: center; }
                        .net-salary span { font-size: 1.1rem; }
                        .net-salary b { font-size: 1.8rem; }
                        
                        .footer { margin-top: 60px; display: flex; justify-content: space-between; text-align: center; }
                        .sig { width: 180px; border-top: 2px solid #333; padding-top: 10px; font-weight: bold; }
                        
                        .watermark { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font-size: 4rem; opacity: 0.03; pointer-events: none; white-space: nowrap; font-weight: 800; color: #000; }
                    </style>
                </head>
                <body>
                    <div class="voucher">
                        <div class="watermark">${branch.name}</div>
                        <div class="header">
                            <div>
                                <h2 style="margin:0; color:#1e293b;">${branch.name}</h2>
                                <p style="margin:5px 0 0; font-size:0.9rem; color:#64748b;">قسم الموارد البشرية والشؤون المالية</p>
                            </div>
                            <img src="${branch.logo}" alt="Logo">
                        </div>
                        
                        <div class="title-box">
                            <h2>فيشة استلام راتب شهري</h2>
                        </div>
                        
                        <div class="info-row">
                            <div class="info-item"><b>اسم الموظف:</b> <span>${u.name}</span></div>
                            <div class="info-item"><b>الصفة الوظيفية:</b> <span>${roleAr}</span></div>
                            <div class="info-item"><b>تاريخ الإصدار:</b> <span>${new Date().toLocaleDateString('ar-IQ')}</span></div>
                            <div class="info-item"><b>رقم القيد الوظيفي:</b> <span>#${u.uid.replace(/\D/g, '') || (u.uid.charCodeAt(0) + u.uid.charCodeAt(1)).toString() + u.uid.slice(-2)}</span></div>
                        </div>
                        
                        <div class="salary-details">
                            <div class="salary-box">
                                <span>الراتب الاسمي</span>
                                <b>${base.toLocaleString()} د.ع</b>
                            </div>
                            <div class="salary-box">
                                <span>المخصصات والإضافات</span>
                                <b style="color:#2563eb;">+${allowance.toLocaleString()} د.ع</b>
                            </div>
                            <div class="salary-box">
                                <span>الاستقطاعات</span>
                                <b style="color:#dc2626;">-${deduction.toLocaleString()} د.ع</b>
                            </div>
                            
                            <div class="net-salary">
                                <span>صافي المبلغ المستلم نهائياً:</span>
                                <b>${netSalary.toLocaleString()} دينار عراقي</b>
                            </div>
                        </div>
                        
                        <div style="margin-top:30px; font-size:0.85rem; color:#64748b; font-style: italic;">
                            * أقر أنا الموظف المذكور أعلاه باستلامي كامل مستحقاتي المالية عن الشهر الحالي، ولا يحق لي المطالبة بأي مبالغ إضافية لاحقاً.
                        </div>
                        
                        <div class="footer">
                            <div class="sig">توقيع الموظف</div>
                            <div class="sig">توقيع المحاسب</div>
                            <div class="sig">مصادقة الإدارة</div>
                        </div>
                    </div>
                    <script>window.onload = function() { setTimeout(() => { window.print(); }, 500); }<\/script>
                <\/body>
                <\/html>
            `);
            printWindow.document.close();
        }

