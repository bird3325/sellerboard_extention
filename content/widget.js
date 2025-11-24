/**
 * 셀러보드 플로팅 위젯 - 알리익스프레스 대응 완전판
 * 드래그 + MutationObserver + Health Check
 */

console.log('[셀러보드] widget.js 로드됨');

(function () {
    'use strict';

    if (window.sellerboardWidgetLoaded) {
        console.log('[셀러보드] 이미 로드됨');
        return;
    }
    window.sellerboardWidgetLoaded = true;

    // 애니메이션 CSS
    if (!document.getElementById('sb-animations')) {
        document.head.insertAdjacentHTML('beforeend', `
            <style id="sb-animations">
                @keyframes sbSlideIn {
                    from { opacity: 0; transform: translateX(20px) scale(0.95); }
                    to { opacity: 1; transform: translateX(0) scale(1); }
                }
                @keyframes sbSlideOut {
                    from { opacity: 1; transform: translateX(0) scale(1); }
                    to { opacity: 0; transform: translateX(20px) scale(0.95); }
                }
                .sb-enter { animation: sbSlideIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
                .sb-exit { animation: sbSlideOut 0.2s ease-out forwards; }
            </style>
        `);
    }

    function initWidget() {
        if (!document.body) {
            setTimeout(initWidget, 100);
            return;
        }

        console.log('[셀러보드] 위젯 초기화 중...');

        // 위젯 HTML
        const widgetHTML = `
            <div id="sb-widget" style="position:fixed!important;z-index:2147483647!important;display:block!important;visibility:visible!important;pointer-events:auto!important;transform:translate3d(0,0,0)!important;isolation:isolate!important;top:20px;right:20px;">
                <div id="sb-btn" style="width:50px!important;height:50px!important;background:linear-gradient(135deg,#6366f1,#4f46e5)!important;border-radius:50%!important;box-shadow:0 4px 12px rgba(99,102,241,0.4)!important;cursor:grab!important;display:flex!important;align-items:center!important;justify-content:center!important;color:white!important;font-weight:700!important;font-size:24px!important;font-family:system-ui,sans-serif!important;user-select:none!important;visibility:visible!important;transition:transform 0.2s!important;">S</div>
            </div>
        `;

        // 팝업 HTML
        const popupHTML = `
            <div id="sb-popup" style="position:fixed!important;z-index:2147483646!important;width:320px!important;background:white!important;border-radius:16px!important;box-shadow:0 20px 60px rgba(0,0,0,0.3)!important;overflow:hidden!important;display:none!important;font-family:system-ui,sans-serif!important;top:80px;right:20px;">
                <div id="sb-header" style="background:linear-gradient(135deg,#6366f1,#4f46e5)!important;padding:16px!important;display:flex!important;justify-content:space-between!important;align-items:center!important;cursor:move!important;user-select:none!important;">
                    <div style="color:white!important;font-weight:600!important;font-size:16px!important;display:flex!important;align-items:center!important;gap:8px!important;">
                        <div style="width:22px!important;height:22px!important;background:white!important;border-radius:4px!important;display:flex!important;align-items:center!important;justify-content:center!important;font-weight:700!important;font-size:13px!important;color:#6366f1!important;">S</div>
                        셀러보드
                    </div>
                    <button id="sb-close" style="background:rgba(255,255,255,0.2)!important;border:none!important;color:white!important;width:28px!important;height:28px!important;border-radius:6px!important;cursor:pointer!important;font-size:18px!important;">✕</button>
                </div>
                <div style="padding:16px!important;">
                    <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px;">
                        <button id="sb-collect" style="background:linear-gradient(135deg,#6366f1,#4f46e5)!important;color:white!important;border:none!important;padding:12px 16px!important;border-radius:10px!important;cursor:pointer!important;font-weight:600!important;font-size:14px!important;display:flex!important;align-items:center!important;justify-content:center!important;gap:8px!important;">
                            <span>📦</span> 상품 수집
                        </button>
                        <button id="sb-drag" style="background:linear-gradient(135deg,#f59e0b,#d97706)!important;color:white!important;border:none!important;padding:12px 16px!important;border-radius:10px!important;cursor:pointer!important;font-weight:600!important;font-size:14px!important;display:flex!important;align-items:center!important;justify-content:center!important;gap:8px!important;">
                            <span>🎯</span> 영역 선택
                        </button>
                    </div>
                    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px;">
                        <div style="background:rgba(99,102,241,0.05);padding:12px;border-radius:10px;text-align:center;">
                            <div id="sb-today" style="font-size:24px;font-weight:700;color:#6366f1;">0</div>
                            <div style="font-size:11px;color:#6b7280;margin-top:4px;">오늘 수집</div>
                        </div>
                        <div style="background:rgba(99,102,241,0.05);padding:12px;border-radius:10px;text-align:center;">
                            <div id="sb-total" style="font-size:24px;font-weight:700;color:#6366f1;">0</div>
                            <div style="font-size:11px;color:#6b7280;margin-top:4px;">총 상품</div>
                        </div>
                    </div>
                    <div style="border-top:1px solid #e5e7eb;padding-top:12px;display:flex;justify-content:space-between;align-items:center;">
                        <span style="color:#1f2937;font-weight:500;font-size:13px;">대시보드</span>
                        <button id="sb-dashboard" style="background:rgba(99,102,241,0.1);color:#6366f1;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;">열기 →</button>
                    </div>
                </div>
            </div>
        `;

        // DOM에 추가
        if (!document.getElementById('sb-widget')) {
            document.body.insertAdjacentHTML('beforeend', widgetHTML);
            document.body.insertAdjacentHTML('beforeend', popupHTML);
            console.log('[셀러보드] ✅ 위젯 추가 완료');
        }

        const widget = document.getElementById('sb-widget');
        const btn = document.getElementById('sb-btn');
        const popup = document.getElementById('sb-popup');
        const header = document.getElementById('sb-header');
        const closeBtn = document.getElementById('sb-close');
        const collectBtn = document.getElementById('sb-collect');
        const dragBtn = document.getElementById('sb-drag');
        const dashboardBtn = document.getElementById('sb-dashboard');

        if (!widget || !popup) {
            console.error('[셀러보드] 위젯 요소를 찾을 수 없음');
            return;
        }

        // 알리익스프레스 보호
        function ensureVisible() {
            if (widget && document.body.contains(widget)) {
                widget.style.cssText = `position:fixed!important;z-index:2147483647!important;display:block!important;visibility:visible!important;pointer-events:auto!important;transform:translate3d(0,0,0)!important;isolation:isolate!important;${widget.style.top ? 'top:' + widget.style.top + ';' : 'top:20px;'}${widget.style.left ? 'left:' + widget.style.left + ';' : ''}${widget.style.right ? 'right:' + widget.style.right + ';' : 'right:20px;'}`;
                if (btn) btn.style.visibility = 'visible';
            } else if (widget && !document.body.contains(widget)) {
                console.log('[셀러보드] ⚠️ 위젯 복구 중...');
                setTimeout(initWidget, 100);
            }
        }

        const observer = new MutationObserver(() => {
            if (!document.body.contains(widget)) {
                console.log('[셀러보드] ⚠️ 위젯이 제거됨, 복구 중...');
                setTimeout(initWidget, 100);
            }
        });
        observer.observe(document.body, { childList: true });
        setInterval(ensureVisible, 2000);

        // 상태
        let isOpen = false;
        let dragging = false;
        let dragType = null;
        let startX = 0, startY = 0, initX = 0, initY = 0;

        // 위치 복원
        chrome.storage.local.get(['widgetPos'], (r) => {
            if (r.widgetPos) {
                widget.style.left = r.widgetPos.left + 'px';
                widget.style.top = r.widgetPos.top + 'px';
                widget.style.right = 'auto';
            }
        });

        // 팝업 토글
        window.sellerboardWidget = {
            open: () => {
                isOpen = true;
                popup.style.display = 'block';
                popup.classList.add('sb-enter');
                popup.classList.remove('sb-exit');
                btn.style.display = 'none';
                chrome.runtime.sendMessage({ action: 'getStats' }, (r) => {
                    if (r) {
                        document.getElementById('sb-today').textContent = r.today || 0;
                        document.getElementById('sb-total').textContent = r.total || 0;
                    }
                });
            },
            close: () => {
                isOpen = false;
                popup.classList.add('sb-exit');
                popup.classList.remove('sb-enter');
                setTimeout(() => {
                    if (!isOpen) {
                        popup.style.display = 'none';
                        btn.style.display = 'flex';
                    }
                }, 200);
            }
        };

        // 드래그
        btn.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            dragging = true;
            dragType = 'widget';
            const r = widget.getBoundingClientRect();
            startX = e.clientX;
            startY = e.clientY;
            initX = r.left;
            initY = r.top;
            btn.style.cursor = 'grabbing';
            e.preventDefault();
        });

        header.addEventListener('mousedown', (e) => {
            if (e.button !== 0 || e.target.id === 'sb-close') return;
            dragging = true;
            dragType = 'popup';
            const r = popup.getBoundingClientRect();
            startX = e.clientX;
            startY = e.clientY;
            initX = r.left;
            initY = r.top;
            header.style.cursor = 'grabbing';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            let x = initX + dx;
            let y = initY + dy;

            if (dragType === 'widget') {
                x = Math.max(0, Math.min(x, window.innerWidth - 50));
                y = Math.max(0, Math.min(y, window.innerHeight - 50));
                widget.style.left = x + 'px';
                widget.style.top = y + 'px';
                widget.style.right = 'auto';
            } else if (dragType === 'popup') {
                x = Math.max(0, Math.min(x, window.innerWidth - 320));
                y = Math.max(0, Math.min(y, window.innerHeight - popup.offsetHeight));
                popup.style.left = x + 'px';
                popup.style.top = y + 'px';
                popup.style.right = 'auto';
            }
        });

        document.addEventListener('mouseup', (e) => {
            if (dragging && dragType === 'widget') {
                const moved = Math.abs(e.clientX - startX) > 5 || Math.abs(e.clientY - startY) > 5;
                dragging = false;
                dragType = null;
                btn.style.cursor = 'grab';
                const r = widget.getBoundingClientRect();
                chrome.storage.local.set({ widgetPos: { left: r.left, top: r.top } });
                if (!moved) window.sellerboardWidget.open();
            } else if (dragging) {
                dragging = false;
                dragType = null;
                header.style.cursor = 'move';
            }
        });

        // 이벤트
        btn.addEventListener('mouseenter', () => !dragging && (btn.style.transform = 'scale(1.1)'));
        btn.addEventListener('mouseleave', () => !dragging && (btn.style.transform = 'scale(1)'));
        closeBtn.addEventListener('click', () => window.sellerboardWidget.close());
        closeBtn.addEventListener('mouseenter', () => closeBtn.style.background = 'rgba(255,255,255,0.3)');
        closeBtn.addEventListener('mouseleave', () => closeBtn.style.background = 'rgba(255,255,255,0.2)');

        collectBtn.addEventListener('click', async () => {
            collectBtn.innerHTML = '<span>⏳</span> 수집 중...';
            collectBtn.disabled = true;
            try {
                if (typeof productParser !== 'undefined') {
                    const data = await productParser.extractProductData();
                    chrome.runtime.sendMessage({ action: 'saveProduct', data }, (r) => {
                        if (r?.success) {
                            collectBtn.innerHTML = '<span>✓</span> 완료!';
                            collectBtn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
                            setTimeout(() => {
                                collectBtn.innerHTML = '<span>📦</span> 상품 수집';
                                collectBtn.style.background = 'linear-gradient(135deg, #6366f1, #4f46e5)';
                                collectBtn.disabled = false;
                            }, 2000);
                        } else throw new Error(r?.error || '실패');
                    });
                } else throw new Error('Parser 없음');
            } catch (e) {
                collectBtn.innerHTML = '<span>✗</span> 실패';
                collectBtn.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
                setTimeout(() => {
                    collectBtn.innerHTML = '<span>📦</span> 상품 수집';
                    collectBtn.style.background = 'linear-gradient(135deg, #6366f1, #4f46e5)';
                    collectBtn.disabled = false;
                }, 3000);
            }
        });

        dragBtn.addEventListener('click', () => {
            if (window.dragSelector) window.dragSelector.toggle();
            window.sellerboardWidget.close();
        });

        dashboardBtn.addEventListener('click', () => chrome.runtime.sendMessage({ action: 'openDashboard' }));
        dashboardBtn.addEventListener('mouseenter', () => dashboardBtn.style.background = 'rgba(99,102,241,0.2)');
        dashboardBtn.addEventListener('mouseleave', () => dashboardBtn.style.background = 'rgba(99,102,241,0.1)');

        console.log('[셀러보드] ✅ 초기화 완료!');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWidget);
    } else {
        initWidget();
    }
})();

console.log('[셀러보드] widget.js 실행 완료');
