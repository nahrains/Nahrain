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
        }

        let accountantStudents = [];
        let accountantStaff = [];
        let accountantFinance = { revenues: [], expenses: [], defaults: {}, global: {}, expenseCategories: [], auditLogs: [] };

        async function loadAccountantData() {
            const userBranchId = currentUser ? currentUser.branchId : 'samawah';
            const branchInfo = (window.NAHRAIN_BRANCHES && window.NAHRAIN_BRANCHES[userBranchId]) ? window.NAHRAIN_BRANCHES[userBranchId] : null;
            const branchTitleElem = document.getElementById('acc-branch-title');
            if (branchTitleElem && branchInfo) branchTitleElem.innerText = `فرع: ${branchInfo.name}`;

            try {
                const usersSnap = await firebase.database().ref('users').once('value');
                const finSnap = await firebase.database().ref('finance').once('value');
                const defaultsSnap = await firebase.database().ref('financialSettings/defaults').once('value');
                const catsSnap = await firebase.database().ref('financialSettings/expenseCategories').once('value');
                const globalDatesSnap = await firebase.database().ref('financialSettings/globalDates').once('value');
                const instCountSnap = await firebase.database().ref('financialSettings/installmentCount').once('value');
                
                accountantFinance.globalDates = globalDatesSnap.val() || {};
                accountantFinance.installmentCount = instCountSnap.val() || 5;
                const structSnap = await firebase.database().ref('settings/branches/' + userBranchId + '/structure').once('value');
                
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
            } catch (e) { console.error(e); }
        }

        function getClassName(classId) {
            if (!classId || !window.schoolStructure) return '-';
            for (let dept of window.schoolStructure) {
                if (dept.stages) {
                    for (let st of dept.stages) {
                        if (st.sections) {
                            for (let sc of st.sections) if (sc.id === classId) return `${dept.name} - ${st.name} - ${sc.name}`;
                        }
                    }
                }
            }
            return classId;
        }

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

                const accClassSelect = document.getElementById('acc-filter-section');
                if (accClassSelect) {
                    let currentVal = accClassSelect.value;
                    let optsHtml = '<option value="all">جميع الشعب والأقسام</option>';
                    if (window.schoolStructure) {
                        window.schoolStructure.forEach(dept => {
                            if (dept.stages) {
                                dept.stages.forEach(st => {
                                    if (st.sections) st.sections.forEach(sc => {
                                        optsHtml += `<option value="${sc.id}">${dept.name} - ${st.name} - ${sc.name}</option>`;
                                    });
                                });
                            }
                        });
                    }
                    accClassSelect.innerHTML = optsHtml;
                    if (currentVal) accClassSelect.value = currentVal;
                }

                const tbodyStd = document.querySelector('#acc-students-table tbody');
                if (tbodyStd) {
                    tbodyStd.innerHTML = '';
                    if (accountantStudents.length === 0) {
                        tbodyStd.innerHTML = '<tr><td colspan="8" style="text-align:center;">لا يوجد طلاب مسجلين بعد.</td></tr>';
                    } else {
                        let htmlStr = '';
                        accountantStudents.forEach(s => {
                            let paid = studentPayments[s.uid] || 0;
                            let tuition = (s.finance && s.finance.tuition !== undefined && s.finance.tuition !== "") ? Number(s.finance.tuition) : (Number(accountantFinance.defaults[s.classId]) || 0);
                            let transportFee = Number(s.finance?.transportFee) || 0;
                            let discount = Number(s.finance?.discount) || 0;
                            let netRequired = (tuition + transportFee) - discount;
                            let remaining = netRequired - paid;
                            let readableClass = getClassName(s.classId);
                            
                            let isLate = false;
                            const now = new Date();
                            const instCount = accountantFinance.installmentCount || 5;
                            const g = accountantFinance.globalDates || {};
                            if (remaining > 0) {
                                [g.inst1, g.inst2, g.inst3, g.inst4, g.inst5].forEach((d, idx) => {
                                    if (d && new Date(d) < now) {
                                        const expectedByNow = (netRequired / instCount) * (idx + 1);
                                        if (paid < expectedByNow) isLate = true;
                                    }
                                });
                            }
                            
                            let paidChip = `<div class="status-chip chip-paid"><i class="fa-solid fa-circle-check"></i> ${paid.toLocaleString('en-US')} د.ع</div>`;
                            let remainingChip = remaining > 0 ? `<div class="status-chip chip-debt"><i class="fa-solid fa-circle-exclamation"></i> ${remaining.toLocaleString('en-US')} د.ع</div>` : `<div class="status-chip chip-paid"><i class="fa-solid fa-crown"></i> مكتمل</div>`;
                            let lateAlert = isLate ? `<div style="display:flex; align-items:center; gap:5px; color:#e11d48; font-size:0.75rem; font-weight:800; background:#fff1f2; padding:2px 8px; border-radius:6px; margin-top:5px; width:fit-content;"><i class="fa-solid fa-bolt-lightning"></i> متأخر عن الدفع</div>` : '';

                            htmlStr += `
                                <tr class="acc-row" data-class-id="${s.classId || ''}">
                                    <td>
                                        <div style="font-weight:800; color:#1e293b; font-size:1.1rem; letter-spacing:-0.5px;">${s.name || 'غير محدد'}</div>
                                        <div style="display:flex; align-items:center; gap:8px; margin-top:4px;"><span style="font-size:0.75rem; background:#f1f5f9; color:#64748b; padding:2px 8px; border-radius:6px; font-weight:600;">${readableClass}</span>${lateAlert}</div>
                                    </td>
                                    <td style="text-align:right;"><div style="font-size:0.75rem; color:#94a3b8; font-weight:600;">إجمالي المطالبة</div><div style="font-weight:800; color:#475569; font-size:1rem;">${netRequired.toLocaleString('en-US')} د.ع</div></td>
                                    <td><div style="font-size:0.75rem; color:#94a3b8; font-weight:600; margin-bottom:4px;">تم تسديد</div>${paidChip}</td>
                                    <td><div style="font-size:0.75rem; color:#94a3b8; font-weight:600; margin-bottom:4px;">المتبقي</div>${remainingChip}</td>
                                    <td><div style="display:flex; gap:10px; justify-content:center; align-items:center;"><button class="quick-action-btn btn-whatsapp" onclick="sendWhatsAppReminder('${s.uid}')" title="تنبيه واتساب"><i class="fa-brands fa-whatsapp"></i></button><button class="quick-action-btn btn-share" onclick="window.shareReceiptWhatsApp('${s.uid}')" title="مشاركة الوصل"><i class="fa-solid fa-paper-plane"></i></button></div></td>
                                    <td><div style="display:flex; gap:12px; align-items:center; justify-content:flex-end;"><div style="display:flex; gap:6px; border-left:1px solid #e2e8f0; padding-left:10px; margin-left:5px;"><button class="quick-action-btn" onclick="window.openAccStudentStatement('${s.uid}')" title="كشف حساب"><i class="fa-solid fa-chart-simple"></i></button><button class="quick-action-btn" onclick="window.openAccStudentManage('${s.uid}')" title="الإعدادات"><i class="fa-solid fa-sliders"></i></button></div><button class="btn-pay" onclick="window.openAccStudentPayment('${s.uid}')"><i class="fa-solid fa-plus-circle"></i> تسديد جديد</button></div></td>
                                </tr>`;
                        });
                        tbodyStd.innerHTML = htmlStr;
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
                        let safeNote = (r.note || '').replace(/'/g, "\\'");
                        revHtml += `
                            <tr>
                                <td>${dateObj.toLocaleString('en-US')}</td>
                                <td>${r.note || '-'}</td>
                                <td><span class="acc-badge badge-success">${Number(r.amount || 0).toLocaleString('en-US')} د.ع</span></td>
                                <td>${r.addedBy || 'المحاسب'}</td>
                                <td>
                                    <div style="display:flex; gap:5px;">
                                        <button class="quick-action-btn" onclick="openAccEditTransaction('${r.id}', 'revenue', ${r.amount}, '${safeNote}')" title="تعديل"><i class="fa-solid fa-pen-to-square"></i></button>
                                        <button class="quick-action-btn" style="background:#475569; color:white;" onclick="printAccReceipt('${r.id}', 'revenue', ${r.amount}, '${safeNote}', '${dateObj.toLocaleString('en-US')}', 'مقبوضات عامة', '${r.studentUid || ''}')" title="طباعة"><i class="fa-solid fa-print"></i></button>
                                        <button class="quick-action-btn" style="background:#fee2e2; color:#dc2626;" onclick="deleteAccTransaction('${r.id}', 'revenue')" title="حذف"><i class="fa-solid fa-trash"></i></button>
                                    </div>
                                </td>
                            </tr>`;
                    });
                    tbodyRev.innerHTML = revHtml || '<tr><td colspan="5" style="text-align:center; padding:20px; color:#94a3b8;">لا توجد مقبوضات تطابق البحث</td></tr>';

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
                        let safeNote = (e.note || '').replace(/'/g, "\\'");
                        let safePayee = (e.payee || '').replace(/'/g, "\\'");
                        let safeRef = (e.refNum || '').replace(/'/g, "\\'");
                        
                        expHtml += `
                            <tr>
                                <td style="font-size:0.8rem;">${dateObj.toLocaleDateString('ar-IQ')}</td>
                                <td><span class="acc-badge" style="background:#f1f5f9; color:#475569;">${e.category || 'أخرى'}</span></td>
                                <td style="font-weight:bold; color:#1e293b;">${e.payee || '-'}</td>
                                <td style="font-size:0.85rem; color:#64748b;">${e.note || '-'} ${e.refNum ? `<br><small style="color:#94a3b8;">Ref: ${e.refNum}</small>` : ''}</td>
                                <td><span class="acc-badge badge-danger" style="font-weight:800;">${Number(e.amount || 0).toLocaleString('en-US')} د.ع</span></td>
                                <td style="font-size:0.75rem; color:#94a3b8;">${e.addedBy || 'المحاسب'}</td>
                                <td>
                                    <div style="display:flex; gap:5px;">
                                        <button class="quick-action-btn" onclick="openAccEditTransaction('${e.id}', 'expense', ${e.amount}, '${safeNote}')" title="تعديل"><i class="fa-solid fa-pen-to-square"></i></button>
                                        <button class="quick-action-btn" style="background:#475569; color:white;" onclick="printAccReceipt('${e.id}', 'expense', ${e.amount}, '${safeNote}', '${dateObj.toLocaleString('en-US')}', '${e.category}', '', '', '${safePayee}', '${e.method || 'نقداً'}', '${safeRef}')" title="طباعة السند"><i class="fa-solid fa-print"></i></button>
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

                // Render Transport Table
                const tbodyTrans = document.querySelector('#acc-transport-table tbody');
                if (tbodyTrans) {
                    let transHtml = '';
                    const subs = accountantStudents.filter(s => s.transportLine || (Number(s.transportFee) > 0));
                    subs.forEach(s => {
                        transHtml += `
                            <tr>
                                <td style="font-weight:700;">${s.name || '---'}</td>
                                <td><span class="acc-badge" style="background:#f1f5f9; color:#475569;">${s.transportLine || 'غير محدد'}</span></td>
                                <td style="font-weight:800; color:#1e3a8a;">${Number(s.transportFee || 0).toLocaleString()} د.ع</td>
                            </tr>
                        `;
                    });
                    tbodyTrans.innerHTML = transHtml || '<tr><td colspan="3" style="text-align:center; padding:20px; color:#94a3b8;">لا يوجد مشتركون مسجلون حالياً</td></tr>';
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
                        <h4 style="margin-top:0; color:#1e3a8a; border-bottom:2px solid #f1f5f9; padding-bottom:10px;"><i class="fa-solid fa-calendar-check"></i> جدولة مواعيد ونسب الأقساط العامة:</h4>
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
                await firebase.database().ref('finance/auditLogs').push({
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
                await firebase.database().ref('financialSettings/defaults/' + sectionId).set(amount);
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
            console.log("Updating Accountant Reports...");
            
            // 1. Calculate General Totals from Students
            let totalExpected = 0;
            let totalPaid = 0;
            let totalDebt = 0;

            accountantStudents.forEach(s => {
                const tuition = (s.finance && s.finance.tuition !== undefined && s.finance.tuition !== "") ? Number(s.finance.tuition) : (Number(accountantFinance.defaults[s.classId]) || 0);
                const transport = Number(s.finance?.transportFee) || 0;
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
            now.setHours(23,59,59,999); // Reset now to end of day for comparison
            
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

            document.getElementById('acc-rep-daily-in').innerText = dayStats.in.toLocaleString();
            document.getElementById('acc-rep-daily-out').innerText = dayStats.out.toLocaleString();
            
            document.getElementById('acc-rep-weekly-in').innerText = weekStats.in.toLocaleString();
            document.getElementById('acc-rep-weekly-out').innerText = weekStats.out.toLocaleString();
            
            document.getElementById('acc-rep-monthly-in').innerText = monthStats.in.toLocaleString();
            document.getElementById('acc-rep-monthly-out').innerText = monthStats.out.toLocaleString();

            // 3. Update Charts
            updateAccCharts();
        }

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

        function filterAccStudents() {
            let q = document.getElementById('acc-search-student').value.toLowerCase();
            let showDebtorsOnly = document.getElementById('acc-filter-debtors').checked;
            let classFilter = document.getElementById('acc-filter-section') ? document.getElementById('acc-filter-section').value : 'all';
            let rows = document.querySelectorAll('#acc-students-table tbody tr');
            rows.forEach(r => {
                let textMatches = r.innerText.toLowerCase().includes(q);
                let remainingCell = r.querySelector('.chip-debt');
                let debtorMatches = showDebtorsOnly ? remainingCell !== null : true;
                let classMatches = (classFilter === 'all') || (r.getAttribute('data-class-id') === classFilter);
                r.style.display = (textMatches && debtorMatches && classMatches) ? '' : 'none';
            });
        }

        function printAccDebtorsReport() {
            let rows = document.querySelectorAll('#acc-students-table tbody tr');
            let data = [];
            rows.forEach(r => {
                if (r.style.display !== 'none') {
                    let nameElem = r.querySelector('td:nth-child(1) div');
                    let classElem = r.querySelector('td:nth-child(1) span');
                    if (!nameElem || !classElem) return;
                    let name = nameElem.innerText;
                    let className = classElem.innerText;
                    let paid = r.querySelector('.chip-paid')?.innerText || '0';
                    let remaining = r.querySelector('.chip-debt')?.innerText || '0';
                    data.push({ name, className, paid, remaining });
                }
            });
            let printWindow = window.open('', '_blank');
            if (!printWindow) return showCustomAlert('تنبيه', 'يرجى السماح بالنوافذ المنبثقة لطباعة التقرير', 'warning');
            let html = `<html><head><title>تقرير المتلكئين</title><style>body { font-family: 'Cairo', sans-serif; direction: rtl; padding: 20px; } table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #333; padding: 10px; text-align: center; }</style></head><body><h2>كشف الطلاب المتلكئين</h2><table><thead><tr><th>الاسم</th><th>الشعبة</th><th>المسدد</th><th>المتبقي</th></tr></thead><tbody>${data.map(s => `<tr><td>${s.name}</td><td>${s.className}</td><td>${s.paid}</td><td>${s.remaining}</td></tr>`).join('')}</tbody></table></body></html>`;
            printWindow.document.write(html);
            printWindow.document.close();
            setTimeout(() => { if (printWindow && !printWindow.closed) printWindow.print(); }, 500);
        }

        function filterAccHR() {
            let q = document.getElementById('acc-search-hr').value.toLowerCase();
            let rows = document.querySelectorAll('#acc-hr-table tbody tr');
            rows.forEach(r => { r.style.display = r.innerText.toLowerCase().includes(q) ? '' : 'none'; });
        }

        async function addAccTransaction(type, passedUid = null, passedNote = null, passedAmount = null, passedCategory = null, passedTimestamp = null, passedBranchId = null) {
            let amountStr = passedAmount !== null ? passedAmount : document.getElementById(type === 'revenue' ? 'acc-rev-amount' : 'acc-exp-amount').value;
            let note = passedNote !== null ? passedNote : document.getElementById(type === 'revenue' ? 'acc-rev-note' : 'acc-exp-note').value;
            let category = passedCategory || (type === 'expense' ? document.getElementById('acc-exp-category').value : 'مقبوضات');
            let payee = passedAmount === null ? (document.getElementById('acc-exp-payee')?.value || '') : '';
            let method = passedAmount === null ? (document.getElementById('acc-exp-method')?.value || 'نقداً') : 'نقداً';
            let refNum = passedAmount === null ? (document.getElementById('acc-exp-ref')?.value || '') : '';
            
            let amount = parseFloat(String(amountStr).replace(/,/g, ''));
            if (!amount || amount <= 0 || !note.trim()) { showCustomAlert('تنبيه', 'بيانات غير صحيحة', 'error'); return; }
            
            const timestamp = passedTimestamp || Date.now();
            const branchId = passedBranchId || currentUser?.branchId || 'samawah';
            const ref = firebase.database().ref(`finance/${type}s`).push();
            const data = { id: ref.key, amount, note, payee, method, refNum, category, timestamp, addedBy: currentUser?.name || 'محاسب', branchId: branchId, studentUid: passedUid || null };
            
            try {
                await ref.set(data);
                loadAccountantData();
                return ref.key;
            } catch(e) { alert(e.message); throw e; }
        }

        async function submitAccStudentPayment() {
            let uid = document.getElementById('acc-payment-uid').value;
            let name = document.getElementById('acc-payment-name').value;
            let amountStr = document.getElementById('acc-payment-amount').value;
            let note = document.getElementById('acc-payment-note').value || `تسديد قسط الطالب ${name}`;
            let nextDate = document.getElementById('acc-payment-next-date').value;
            let amount = parseFloat(amountStr.replace(/,/g, '')) || 0;
            if (!amount || amount <= 0) return showCustomAlert('تنبيه', 'الرجاء إدخال مبلغ صحيح.', 'error');
            try {
                const transactionId = await addAccTransaction('revenue', uid, note, amount, 'قسط طالب');
                if(nextDate) await firebase.database().ref(`users/${uid}/finance/nextDueDate`).set(nextDate);
                let dateStr = new Date().toLocaleString('ar-IQ');
                printAccReceipt(transactionId, 'revenue', amount, note, dateStr, 'قسط طالب', uid, nextDate);
                document.getElementById('acc-modal-overlay').style.display = 'none';
                document.getElementById('acc-payment-modal').style.display = 'none';
                loadAccountantData();
            } catch(e) { alert(e.message); }
        }



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
            
            let studentName = '................................';
            let studentClass = '....................';
            let netTuition = 0;
            let totalPaid = 0;
            let remaining = 0;
            let nextDueDate = nextDueDateOverride || '---';
            let lastPaymentDate = '---';

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
                    remaining = netTuition - totalPaid;
                    
                    if (myRevs.length > 0) {
                        const latest = [...myRevs].sort((a,b) => b.timestamp - a.timestamp)[0];
                        lastPaymentDate = new Date(latest.timestamp).toLocaleDateString('ar-IQ');
                    }
                    if (!nextDueDateOverride) nextDueDate = s.finance?.nextDueDate || '---';
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
                                <div>رقم السند: <b contenteditable="true">#${id.substring(0, 8).toUpperCase()}</b></div>
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
                html = `
                <html>
                <head>
                    <title>${typeLabel} - ${studentName}</title>
                    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
                    <style>
                        body { font-family: 'Cairo', sans-serif; direction: rtl; text-align: right; padding: 0; margin: 0; background: #f1f5f9; }
                        .receipt-outer { 
                            background: white; 
                            border: 1px solid #e2e8f0;
                            padding: 30px 45px; 
                            width: 210mm; 
                            height: 148mm; 
                            margin: 20px auto; 
                            display: flex; 
                            flex-direction: column; 
                            box-sizing: border-box; 
                            position: relative;
                            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
                            border-radius: 12px;
                            overflow: hidden;
                        }
                        .receipt-outer::before {
                            content: "";
                            position: absolute;
                            top: 0; left: 0; right: 0;
                            height: 8px;
                            background: ${headerColor};
                        }
                        .top-meta { display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 20px; color: #64748b; font-weight: 600; }
                        .school-brand { text-align: center; margin-bottom: 25px; display: flex; align-items: center; justify-content: center; gap: 20px; }
                        .school-brand img { height: 70px; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.1)); }
                        .brand-text h1 { margin: 0; font-size: 1.6rem; color: #1e293b; font-weight: 900; letter-spacing: -0.5px; }
                        .brand-text p { margin: 0; color: ${headerColor}; font-weight: 700; font-size: 0.9rem; }
                        
                        .receipt-title-wrap { position: relative; text-align: center; margin-bottom: 30px; }
                        .receipt-title { 
                            display: inline-block;
                            background: ${titleBg}; 
                            color: ${headerColor}; 
                            padding: 10px 50px; 
                            font-weight: 900; 
                            font-size: 1.4rem; 
                            border: 2px solid ${headerColor}; 
                            border-radius: 12px;
                            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
                        }
                        
                        .narrative { 
                            font-size: 1.15rem; 
                            line-height: 2.2; 
                            margin-bottom: 25px; 
                            background: #f8fafc;
                            padding: 25px; 
                            border-radius: 12px;
                            border: 1px solid #f1f5f9;
                            color: #334155;
                        }
                        .narrative b { color: #0f172a; border-bottom: 2px dashed #cbd5e1; padding: 0 5px; }
                        
                        .finance-summary { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; margin-bottom: 20px; }
                        .f-box { 
                            border: 1px solid #e2e8f0; 
                            padding: 12px; 
                            text-align: center; 
                            border-radius: 10px; 
                            background: white;
                            transition: all 0.2s;
                        }
                        .f-box small { display: block; color: #64748b; font-weight: 700; font-size: 0.75rem; margin-bottom: 5px; text-transform: uppercase; }
                        .f-box b { font-size: 1.2rem; color: #1e293b; font-weight: 900; }
                        .f-box.highlight { background: ${titleBg}; border-color: ${headerColor}; }
                        .f-box.highlight b { color: ${headerColor}; }

                        .footer-sigs { display: flex; justify-content: space-between; margin-top: auto; padding-top: 20px; }
                        .sig-area { text-align: center; width: 28%; font-size: 0.9rem; font-weight: 800; color: #475569; }
                        .sig-line { border-top: 2px solid #e2e8f0; margin-top: 45px; position: relative; }
                        .sig-line::after { content: "توقيع الموظف"; position: absolute; top: 10px; left: 0; right: 0; font-size: 0.7rem; color: #94a3b8; font-weight: 400; }
                        .sig-area:first-child .sig-line::after { content: "توقيع المستلم"; }
                        .sig-area:last-child .sig-line::after { content: "ختم المؤسسة"; }

                        .watermark {
                            position: absolute;
                            top: 50%;
                            left: 50%;
                            transform: translate(-50%, -50%) rotate(-30deg);
                            font-size: 8rem;
                            font-weight: 900;
                            color: rgba(0,0,0,0.03);
                            pointer-events: none;
                            white-space: nowrap;
                            z-index: 0;
                        }

                        .no-print-bar { background: #1e293b; color: white; padding: 15px; text-align: center; display: block; border-bottom: 1px solid #fff; position: sticky; top: 0; z-index: 100; }
                        .no-print-bar button { background: ${headerColor}; color: white; border: none; padding: 10px 35px; font-family: 'Cairo'; font-weight: 800; cursor: pointer; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.2); transition: transform 0.2s; }
                        .no-print-bar button:hover { transform: translateY(-2px); }
                        
                        @media print { 
                            body { background: white !important; }
                            .receipt-outer { margin: 0; box-shadow: none; border: 1px solid #eee; width: 100%; height: 100%; }
                            .no-print { display: none !important; } 
                        }
                    </style>
                </head>
                <body>
                    <div class="no-print-bar no-print">
                        <button onclick="window.print()">🖨️ طباعة الوصل المالي الآن</button>
                    </div>
                    <div class="receipt-outer">
                        <div class="watermark">مدفوع</div>
                        <div class="top-meta">
                            <div>الرقم التسلسلي: <span style="color:#1e293b">#${id.toUpperCase().substring(0, 8)}</span></div>
                            <div>تاريخ الإصدار: <span style="color:#1e293b">${dateStr}</span></div>
                        </div>
                        
                        <div class="school-brand">
                            <div class="brand-text">
                                <h1>مؤسسة النهرين التعليمية الدولية</h1>
                                <p>فرع: ${branch.name.split(' ').pop()}</p>
                            </div>
                        </div>

                        <div class="receipt-title-wrap">
                            <div class="receipt-title">${typeLabel}</div>
                        </div>

                        <div class="narrative">
                            <div>استلمنا من السيد/ة: <b>${studentName}</b></div>
                            <div>مبلغاً وقدره: <b style="color:${headerColor}; font-size:1.4rem;">${amount.toLocaleString()} د.ع</b></div>
                            <div style="font-size:0.9rem; color:#64748b; margin-top:-5px;">(${amountWords})</div>
                            <div style="margin-top:10px;">وذلك عن: <b>${note}</b></div>
                        </div>

                        ${studentUid ? `
                        <div class="finance-summary">
                            <div class="f-box"><small>القسط الكلي</small><b>${netTuition.toLocaleString()}</b></div>
                            <div class="f-box highlight"><small>المسدد التراكمي</small><b>${totalPaid.toLocaleString()}</b></div>
                            <div class="f-box"><small>الرصيد المتبقي</small><b style="color:${remaining > 0 ? '#dc2626' : '#059669'}">${remaining.toLocaleString()}</b></div>
                        </div>` : ''}

                        <div class="footer-sigs">
                            <div class="sig-area">المستلم<div class="sig-line"></div></div>
                            <div class="sig-area">المحاسب المختص<div class="sig-line"></div></div>
                            <div class="sig-area">الختم الرسمي<div class="sig-line"></div></div>
                        </div>
                    </div>
                </body>
                </html>`;
            }
            printWindow.document.write(html);
            printWindow.document.close();
            setTimeout(() => { if(printWindow && !printWindow.closed) printWindow.print(); }, 800);
        };

        window.performGlobalSearch = function (query) {
            const resultsDiv = document.getElementById('acc-search-results');
            if (!query || query.length < 2) {
                resultsDiv.style.display = 'none';
                return;
            }
            const q = query.toLowerCase();
            let html = '';

            // Search Students
            const stds = accountantStudents.filter(s => s.name?.toLowerCase().includes(q)).slice(0, 4);
            if (stds.length > 0) {
                html += '<div class="search-result-group-title"><i class="fa-solid fa-graduation-cap"></i> الطلاب</div>';
                stds.forEach(s => {
                    html += `<div class="search-result-item" onclick="goToAccSearchResult('student', '${s.uid}', '${s.name.replace(/'/g, "\\'")}')">
                        <div class="search-result-info"><span class="title">${s.name}</span><span class="subtitle">${getClassName(s.classId)}</span></div>
                    </div>`;
                });
            }

            // Search Revenues
            const revs = accountantFinance.revenues.filter(r => (r.note?.toLowerCase().includes(q)) || (r.addedBy?.toLowerCase().includes(q))).slice(0, 3);
            if (revs.length > 0) {
                html += '<div class="search-result-group-title"><i class="fa-solid fa-file-invoice-dollar"></i> المقبوضات</div>';
                revs.forEach(r => {
                    html += `<div class="search-result-item" onclick="goToAccSearchResult('revenue', '${r.id}')">
                        <div class="search-result-info"><span class="title">${r.note}</span><span class="subtitle">${new Date(r.timestamp).toLocaleDateString()} - بواسطة: ${r.addedBy}</span></div>
                        <span class="search-result-amount">${Number(r.amount).toLocaleString()} د.ع</span>
                    </div>`;
                });
            }

            // Search Expenses
            const exps = accountantFinance.expenses.filter(e => (e.note?.toLowerCase().includes(q)) || (e.payee?.toLowerCase().includes(q))).slice(0, 3);
            if (exps.length > 0) {
                html += '<div class="search-result-group-title"><i class="fa-solid fa-money-bill-transfer"></i> المصروفات</div>';
                exps.forEach(e => {
                    html += `<div class="search-result-item" onclick="goToAccSearchResult('expense', '${e.id}')">
                        <div class="search-result-info"><span class="title">${e.note}</span><span class="subtitle">${e.payee} - ${e.category}</span></div>
                        <span class="search-result-amount expense">${Number(e.amount).toLocaleString()} د.ع</span>
                    </div>`;
                });
            }

            resultsDiv.innerHTML = html || '<div class="no-results">لا توجد نتائج مطابقة لبحثك</div>';
            resultsDiv.style.display = 'block';
        };

        window.goToAccSearchResult = function (type, id, name = '') {
            const resultsDiv = document.getElementById('acc-search-results');
            resultsDiv.style.display = 'none';
            document.getElementById('acc-global-search-input').value = '';

            if (type === 'student') {
                switchAccTab('students');
                document.getElementById('acc-search-student').value = name;
                filterAccStudents();
                document.getElementById('acc-students-table').scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else if (type === 'revenue') {
                switchAccTab('revenues');
                document.getElementById('acc-revenues-table').scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else if (type === 'expense') {
                switchAccTab('expenses');
                document.getElementById('acc-expenses-table').scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
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
            firebase.database().ref(`users/${uid}/finance`).update(data).then(() => {
                showCustomAlert('تم الحفظ', 'تم تحديث البيانات المالية بنجاح', 'success');
                window.closeAllAccModals();
                loadAccountantData();
            });
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

        window.openAccStudentStatement = function(uid) {
            if (!uid) return;
            window.currentStatementUid = uid;
            const s = accountantStudents.find(x => String(x.uid) === String(uid));
            if (!s) return alert('خطأ: تعذر العثور على بيانات الطالب');

            const tuition = (s.finance?.tuition !== undefined && s.finance.tuition !== '') ? Number(s.finance.tuition) : (Number(accountantFinance.defaults[s.classId]) || 0);
            const transportFee = Number(s.finance?.transportFee) || 0;
            const discount = Number(s.finance?.discount) || 0;
            const netRequired = (tuition + transportFee) - discount;

            // Filter transactions for this student - ensuring string match
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

            // Show Modal with High Priority
            const overlay = document.getElementById('acc-modal-overlay');
            const modal = document.getElementById('acc-statement-modal');
            if (overlay && modal) {
                overlay.style.display = 'block';
                overlay.style.zIndex = '100000';
                modal.style.display = 'block';
                modal.style.zIndex = '100001';
            }
        };

        window.printFullStudentStatement = function(uid) {
            const s = accountantStudents.find(x => String(x.uid) === String(uid));
            if (!s) return;
            
            const userBranchId = currentUser ? currentUser.branchId : 'samawah';
            const branch = (window.NAHRAIN_BRANCHES && window.NAHRAIN_BRANCHES[userBranchId]) ? window.NAHRAIN_BRANCHES[userBranchId] : { name: 'مدرسة النهرين الأهلية', logo: '' };
            
            const tuition = (s.finance?.tuition !== undefined && s.finance.tuition !== '') ? Number(s.finance.tuition) : (Number(accountantFinance.defaults[s.classId]) || 0);
            const transportFee = Number(s.finance?.transportFee) || 0;
            const discount = Number(s.finance?.discount) || 0;
            const netRequired = (tuition + transportFee) - discount;
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
                        body { font-family: 'Cairo', sans-serif; padding: 20px; color: #333; background: #f1f5f9; margin:0; }
                        .a4-container { width: 190mm; min-height: 270mm; margin: 0 auto; background: white; padding: 10mm; border: 1px solid #eee; box-shadow: 0 0 15px rgba(0,0,0,0.1); box-sizing: border-box; position: relative; }
                        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #1e3a8a; padding-bottom: 10px; margin-bottom: 20px; }
                        .header-info h1 { margin: 0; color: #1e3a8a; font-size: 1.6rem; line-height: 1.2; }
                        .header-logo img { height: 65px; }
                        .doc-title { text-align: center; font-size: 1.4rem; font-weight: 900; margin-bottom: 15px; text-decoration: underline; color: #1e3a8a; }
                        .student-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; background: #f8fafc; padding: 15px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #e2e8f0; }
                        .meta-item { font-size: 1rem; }
                        .meta-label { font-weight: bold; color: #64748b; margin-left: 5px; }
                        .finance-summary { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 20px; }
                        .sum-box { border: 2px solid #e2e8f0; padding: 10px; text-align: center; border-radius: 10px; background: white; }
                        .sum-box.highlight { background: #eff6ff; border-color: #3b82f6; }
                        .sum-val { display: block; font-size: 1.2rem; font-weight: 900; color: #1e3a8a; }
                        table { width: 100%; border-collapse: collapse; margin-top: 5px; }
                        th { background: #1e3a8a; color: white; padding: 10px; text-align: center; font-size: 0.9rem; }
                        td { border: 1px solid #e2e8f0; padding: 8px; text-align: center; font-size: 0.9rem; }
                        tr:nth-child(even) { background: #f8fafc; }
                        .footer { margin-top: 40px; display: flex; justify-content: space-between; }
                        .sig-box { width: 180px; text-align: center; font-weight: bold; font-size: 0.9rem; }
                        .sig-line { border-top: 1.5px solid #333; margin-top: 35px; }
                        @media print { 
                            body { background: white !important; padding: 0 !important; margin: 0 !important; }
                            .a4-container { width: 100% !important; margin: 0 !important; border: none !important; box-shadow: none !important; padding: 10mm !important; }
                            .no-print { display: none; }
                        }
                    </style>
                </head>
                <body onload="window.print()">
                    <div class="a4-container">
                        <div class="header">
                            <div class="header-info">
                                <h1>${branch.name}</h1>
                                <p>قسم الشؤون المالية والحسابات</p>
                            </div>
                            <div class="header-logo"><img src="${branch.logo}"></div>
                            <div style="text-align:left;">
                                <div>تاريخ الكشف: <b>${new Date().toLocaleDateString('ar-IQ')}</b></div>
                                <div>رقم الطالب: <b>${uid.substring(0,8)}</b></div>
                            </div>
                        </div>

                        <div class="doc-title">كشف الحساب المالي الموحد</div>

                        <div class="student-meta">
                            <div class="meta-item"><span class="meta-label">اسم الطالب:</span> <b>${s.name}</b></div>
                            <div class="meta-item"><span class="meta-label">الصف والشعبة:</span> <b>${getClassName(s.classId)}</b></div>
                            <div class="meta-item"><span class="meta-label">حالة القيد:</span> <b>نشط</b></div>
                            <div class="meta-item"><span class="meta-label">ولي الأمر:</span> <b>${s.parentName || '---'}</b></div>
                        </div>

                        <div class="finance-summary">
                            <div class="sum-box"><small>المطالبة الكلية</small><span class="sum-val">${netRequired.toLocaleString()} د.ع</span></div>
                            <div class="sum-box highlight"><small>إجمالي المسدد</small><span class="sum-val">${totalPaid.toLocaleString()} د.ع</span></div>
                            <div class="sum-box" style="border-color:#ef4444;"><small>المتبقي بذمته</small><span class="sum-val" style="color:#dc2626;">${remaining.toLocaleString()} د.ع</span></div>
                        </div>

                        <table>
                            <thead>
                                <tr>
                                    <th>ت</th>
                                    <th>التاريخ</th>
                                    <th>رقم السند</th>
                                    <th>البيان / التفاصيل</th>
                                    <th>المبلغ المستلم</th>
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
                                `).join('') : '<tr><td colspan="5">لا توجد حركات مسجلة</td></tr>'}
                            </tbody>
                        </table>

                        <div class="footer">
                            <div class="sig-box">توقيع المحاسب<div class="sig-line"></div></div>
                            <div class="sig-box">الختم الرسمي<div class="sig-line"></div></div>
                            <div class="sig-box">مصادقة الإدارة<div class="sig-line"></div></div>
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

        window.performGlobalSearch = function (q) {
            const res = document.getElementById('acc-search-results'); if (!q || q.length < 2) { res.style.display = 'none'; return; }
            const query = q.toLowerCase();
            let html = '';
            const stds = accountantStudents.filter(s => s.name?.toLowerCase().includes(query)).slice(0, 5);
            if (stds.length > 0) { html += '<div class="search-result-group-title">الطلاب</div>'; stds.forEach(s => { html += `<div class="search-result-item" onclick="goToAccSearchResult('student', '${s.uid}')"><span>${s.name}</span><small>${getClassName(s.classId)}</small></div>`; }); }
            res.innerHTML = html || '<div class="no-results">لا توجد نتائج</div>';
            res.style.display = 'block';
        };

        window.goToAccSearchResult = function (type, id) {
            if (type === 'student') { switchAccTab('students'); setTimeout(() => { const s = accountantStudents.find(x => x.uid === id); if (s) { document.getElementById('acc-search-student').value = s.name; filterAccStudents(); } }, 200); }
            document.getElementById('acc-search-results').style.display = 'none';
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
                await firebase.database().ref(`users/${uid}/payroll`).update({ 
                    base: b, 
                    allowance: a, 
                    deduction: d, 
                    contractStart: start, 
                    contractEnd: end 
                });
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

            Promise.all([
                firebase.database().ref('financialSettings/installmentCount').set(count),
                firebase.database().ref('financialSettings/globalDates').set(dates),
                firebase.database().ref('financialSettings/globalPercents').set(percents)
            ]).then(() => {
                showCustomAlert('تم الحفظ', '✅ تم حفظ المواعيد والنسب بنجاح', 'success');
                loadAccountantData();
            });
        };

        window.saveGlobalInstCount = function() {
            const count = Number(document.getElementById('acc-setting-inst-count').value) || 5;
            firebase.database().ref('financialSettings/installmentCount').set(count).then(() => {
                accountantFinance.installmentCount = count;
                alert('✅ تم تحديث عدد الأقساط الافتراضي في النظام');
                loadAccountantData();
            });
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

            console.log("=== MODAL DEBUG START ===");
            console.log("UID to find:", uid);
            
            if (!uid) {
                console.error("No UID provided!");
                return;
            }

            const s = accountantStudents.find(x => String(x.uid) === String(uid));
            if (!s) {
                console.error("Student NOT found in accountantStudents array. Array size:", accountantStudents.length);
                alert('خطأ: لم يتم العثور على بيانات الطالب في القائمة الحالية.');
                return;
            }
            
            console.log("Student found:", s.name);
            
            const modal = document.getElementById('acc-payment-modal');
            const overlay = document.getElementById('acc-modal-overlay');
            
            if (!modal || !overlay) {
                console.error("Modal (#acc-payment-modal) or Overlay (#acc-modal-overlay) missing from DOM!");
                alert("خطأ تقني: تعذر العثور على نافذة التسديد في الصفحة.");
                return;
            }

            // Move to body if needed to avoid parent clipping
            if (modal.parentElement !== document.body) {
                console.log("Moving modal to document.body");
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
            
            console.log("Modal visibility styles applied.");
            console.log("=== MODAL DEBUG END ===");
        };

        window.deleteAccTransaction = async function(id, type) {
            const confirmed = await showAccConfirm('تأكيد الحذف', 'هل أنت متأكد من حذف هذا السند نهائياً؟ سيؤثر ذلك على الرصيد الكلي ولا يمكن التراجع عنه.');
            if (!confirmed) return;

            try {
                const refPath = `finance/${type}s/${id}`;
                const snap = await firebase.database().ref(refPath).once('value');
                const data = snap.val();
                
                await firebase.database().ref(refPath).remove();
                
                if (window.addAccAuditLog && data) {
                    const action = type === 'revenue' ? 'حذف إيراد' : 'حذف مصروف';
                    const amountText = Number(data.amount || 0).toLocaleString();
                    window.addAccAuditLog(action, `تم حذف سند رقم ${id.substring(0,6).toUpperCase()} بقيمة ${amountText} د.ع - التفاصيل: ${data.note}`, '#fef2f2', '#dc2626');
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
            const academicYear = "2024 / 2025";

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
                    const snap = await firebase.database().ref('users/' + uid).once('value');
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
                password: s.password || "---",
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
            const botToken = "8245850879:AAE0kSJShrLRovqsFUzr0DzMAG8U1XDhUws";
            // يمكنك إضافة الـ Chat ID الخاص بمالك المدرسة هنا في المصفوفة
            const chatIds = ["139671439"]; 
            
            for (const chatId of chatIds) {
                const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
                try {
                    await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' })
                    });
                } catch (e) { console.error("Telegram Notification Error:", e); }
            }
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
            if (type === 'student') {
                switchAccTab('students');
                setTimeout(() => {
                    const stdSearch = document.getElementById('acc-search-students');
                    if (stdSearch) {
                        const s = accountantStudents.find(x => String(x.uid) === String(id));
                        if (s) {
                            stdSearch.value = s.name;
                            filterAccStudents();
                        }
                    }
                }, 200);
            } else if (type === 'revenue') {
                switchAccTab('revenues');
            } else if (type === 'expense') {
                switchAccTab('expenses');
            }
            document.getElementById('acc-search-results').style.display = 'none';
            document.getElementById('acc-global-search-input').value = '';
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

        window.saveEditedTransaction = async function() {
            const id = document.getElementById('edit-tx-id').value;
            const type = document.getElementById('edit-tx-type').value;
            const amount = Number(document.getElementById('edit-tx-amount').value) || 0;
            const note = document.getElementById('edit-tx-note').value;
            
            if (amount <= 0 || !note.trim()) return alert("بيانات غير صالحة");
            
            try {
                await firebase.database().ref(`finance/${type}s/${id}`).update({ amount, note });
                showCustomAlert('تم التعديل', 'تم تحديث بيانات السند بنجاح', 'success');
                window.closeAllAccModals();
                loadAccountantData();
            } catch (e) { alert(e.message); }
        };

        window.removeExpenseCategory = async function(cat) {
            if (!confirm(`هل أنت متأكد من حذف التصنيف (${cat})؟`)) return;
            accountantFinance.expenseCategories = accountantFinance.expenseCategories.filter(c => c !== cat);
            try {
                await firebase.database().ref('financialSettings/expenseCategories').set(accountantFinance.expenseCategories);
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
                await firebase.database().ref('financialSettings/expenseCategories').set(accountantFinance.expenseCategories);
                if (input) input.value = '';
                loadAccountantData();
                showCustomAlert('تمت الإضافة', `تمت إضافة التصنيف (${cat}) بنجاح ✅`, 'success');
            } catch (e) { alert(e.message); }
        };

        // --- CORE TRANSACTION LOGIC ---
        window.addAccTransaction = async function (type, studentUid, note, amount, category, payee = '', method = 'نقداً', refNum = '', manualDate = null) {
            if (!amount || amount <= 0) {
                alert('يرجى إدخال مبلغ صحيح');
                return null;
            }
            const userBranchId = currentUser ? currentUser.branchId : 'samawah';
            const timestamp = manualDate ? new Date(manualDate).getTime() : Date.now();
            const ref = firebase.database().ref(`finance/${type}s`).push();
            const data = {
                id: ref.key,
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
                await ref.set(data);
                
                // Audit Log
                firebase.database().ref('finance/auditLogs').push({
                    action: type === 'revenue' ? 'قيد قبض' : 'قيد صرف',
                    amount,
                    note,
                    timestamp: Date.now(),
                    user: currentUser?.name || 'محاسب',
                    branchId: userBranchId
                });

                // Notifications
                const emoji = type === 'revenue' ? '📈' : '📉';
                const typeLabel = type === 'revenue' ? 'مقبوضات' : 'مصروفات';
                broadcastNotification(`${emoji} <b>تنبيه حركة مالية جديدة</b>\nالفرع: ${userBranchId}\nالنوع: ${typeLabel}\nالمبلغ: ${Number(amount).toLocaleString()} د.ع\nالبيان: ${note}\nالمستخدم: ${currentUser?.name || 'محاسب'}`);

                return ref.key;
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

            try {
                const txId = await window.addAccTransaction('revenue', uid, note, amount, 'أقساط طلاب');
                
                if (nextDueDate) {
                    await firebase.database().ref(`users/${uid}/finance/nextDueDate`).set(nextDueDate);
                }
                
                showCustomAlert('تم التسديد', 'تم استلام المبلغ بنجاح ✅', 'success');
                window.closeAllAccModals();
                loadAccountantData();
                
                // Open Print Window
                setTimeout(() => {
                    window.printAccReceipt(txId, 'revenue', amount, note, new Date().toLocaleString('ar-IQ'), 'أقساط طلاب', uid, nextDueDate);
                }, 500);
            } catch (e) { console.error(e); }
        };

        // --- DELETE TRANSACTION LOGIC ---
        async function deleteAccTransaction(id, type) {
            const confirmed = await showAccConfirm('تأكيد الحذف', 'هل أنت متأكد من حذف هذا السند نهائياً؟ سيؤثر ذلك على الرصيد الكلي ولا يمكن التراجع عنه.');
            if (!confirmed) return;

            try {
                // Get data for logging before removal
                const refPath = `finance/${type}s/${id}`;
                const snap = await firebase.database().ref(refPath).once('value');
                const data = snap.val();
                
                await firebase.database().ref(refPath).remove();
                
                // Log the action
                if (window.addAccAuditLog && data) {
                    const action = type === 'revenue' ? 'حذف إيراد' : 'حذف مصروف';
                    const amountText = Number(data.amount || 0).toLocaleString();
                    window.addAccAuditLog(action, `تم حذف سند رقم ${id.substring(0,6).toUpperCase()} بقيمة ${amountText} د.ع - التفاصيل: ${data.note}`, '#fef2f2', '#dc2626');
                }

                showCustomAlert('تم الحذف', 'تم حذف السند وإلغاء العملية من السجلات بنجاح.', 'success');
                loadAccountantData();
            } catch (e) {
                alert('خطأ أثناء عملية الحذف: ' + e.message);
            }
        }

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
                            <div class="info-item"><b>رقم القيد الوظيفي:</b> <span>#${u.uid.substring(0,6).toUpperCase()}</span></div>
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

