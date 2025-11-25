/**
 * 셀러보드 플로팅 위젯 - 알리익스프레스 대응 완전판
 * Closed Shadow DOM + 드래그 + MutationObserver + Health Check
 */

console.log('[셀러보드] widget.js 로드됨');

(function () {
    'use strict';

    if (window.sellerboardWidgetLoaded) {
        console.log('[셀러보드] 이미 로드됨');
        return;
    }
    window.sellerboardWidgetLoaded = true;

    // Shadow DOM 호스트 생성
    const HOST_ID = 'sb-host-root';
    let shadowRoot = null;
    let hostElement = null;

    function initWidget() {
        if (!document.body) {
            setTimeout(initWidget, 100);
            return;
        }

        // 이미 존재하면 중단
        if (document.getElementById(HOST_ID)) {
            return;
        }

        console.log('[셀러보드] 위젯 초기화 (Shadow DOM)...');

        // 1. 호스트 요소 생성
        hostElement = document.createElement('div');
        hostElement.id = HOST_ID;
        // 전체 화면 크기로 설정하되 pointer-events는 none으로 (Shadow DOM 내부 요소만 클릭 가능)
        hostElement.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; z-index:2147483647; pointer-events:none; overflow:visible;';

        // 2. Shadow DOM 생성 (Closed 모드)
        shadowRoot = hostElement.attachShadow({ mode: 'closed' });

        // 3. 스타일 주입
        const styleLink = document.createElement('link');
        styleLink.rel = 'stylesheet';
        styleLink.href = chrome.runtime.getURL('styles/widget.css');
        shadowRoot.appendChild(styleLink);

        // 애니메이션 스타일
        const animStyle = document.createElement('style');
        animStyle.textContent = `
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
        `;
        shadowRoot.appendChild(animStyle);

        // 4. 위젯 HTML 구조
        const container = document.createElement('div');
        container.className = 'sb-container';
        container.style.cssText = 'pointer-events: auto;'; // 내부 요소는 클릭 가능하게

        container.innerHTML = `
            <!-- 위젯 버튼 -->
            <div id="sb-widget" style="position:fixed !important; z-index:2147483647 !important; top:20px !important; right:20px !important; display:block !important; pointer-events:auto !important; visibility:visible !important; opacity:1 !important;">
                <div id="sb-btn" class="sb-btn-float" style="
                    width: 50px !important;
                    height: 50px !important;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
                    border-radius: 50% !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    color: white !important;
                    font-size: 24px !important;
                    font-weight: bold !important;
                    cursor: grab !important;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important;
                    user-select: none !important;
                    pointer-events: auto !important;
                    visibility: visible !important;
                    opacity: 1 !important;
                ">S</div>
            </div>

            <!-- 팝업 -->
            <div id="sb-popup" class="sb-popup-container" style="position:fixed !important; top:80px !important; right:20px !important; display:none !important; pointer-events:auto !important; z-index:2147483647 !important;">
                <div id="sb-header" class="sb-popup-header">
                    <div class="sb-popup-title">
                        <div class="sb-popup-logo">S</div>
                        셀러보드
                    </div>
                    <button id="sb-close" class="sb-popup-close">✕</button>
                </div>
                <div class="sb-popup-body">
                    <!-- 수집 모드 선택 -->
                    <div class="sb-mode-selector">
                        <div class="sb-mode-label">수집 모드</div>
                        <div class="sb-mode-buttons">
                            <button class="sb-mode-btn active" data-mode="single">
                                <span class="icon">📦</span>
                                <span class="text">단일</span>
                            </button>
                            <button class="sb-mode-btn" data-mode="area">
                                <span class="icon">🎯</span>
                                <span class="text">영역</span>
                            </button>
                            <button class="sb-mode-btn" data-mode="page">
                                <span class="icon">📄</span>
                                <span class="text">페이지</span>
                            </button>
                            <button class="sb-mode-btn" data-mode="bulk">
                                <span class="icon">🏪</span>
                                <span class="text">몰털이</span>
                            </button>
                        </div>
                    </div>

                    <!-- 모드별 설명 -->
                    <div class="sb-mode-description" id="sb-mode-desc">
                        <small>현재 페이지의 상품 정보를 수집합니다</small>
                    </div>

                    <!-- 액션 버튼 -->
                    <div class="sb-button-group">
                        <button id="sb-collect" class="sb-btn primary">
                            <span>🚀</span> 수집 시작
                        </button>
                    </div>

                    <!-- 진행 상황 표시 (숨김 상태) -->
                    <div id="sb-progress" class="sb-progress-container" style="display:none;">
                        <div class="sb-progress-label">
                            <span id="sb-progress-text">수집 중...</span>
                            <span id="sb-progress-count">0/0</span>
                        </div>
                        <div class="sb-progress-bar">
                            <div id="sb-progress-fill" class="sb-progress-fill"></div>
                        </div>
                    </div>

                    <!-- 통계 -->
                    <div class="sb-stats-grid">
                        <div class="sb-stat-card">
                            <div id="sb-today" class="sb-stat-number">0</div>
                            <div class="sb-stat-label">오늘 수집</div>
                        </div>
                        <div class="sb-stat-card">
                            <div id="sb-total" class="sb-stat-number">0</div>
                            <div class="sb-stat-label">총 상품</div>
                        </div>
                    </div>

                    <!-- 대시보드 버튼 -->
                    <div class="sb-settings">
                        <div class="sb-settings-item">
                            <span class="sb-settings-label">대시보드</span>
                            <button id="sb-dashboard" class="sb-btn secondary">열기 →</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        shadowRoot.appendChild(container);
        document.body.appendChild(hostElement);
        console.log('[셀러보드] ✅ Shadow DOM 위젯 추가 완료');

        // 스타일 강제 적용 (AliExpress가 스타일을 변경하지 못하도록)
        const widget = container.querySelector('#sb-widget');
        const btn = container.querySelector('#sb-btn');

        function enforceStyles() {
            if (widget) {
                widget.style.setProperty('display', 'block', 'important');
                widget.style.setProperty('visibility', 'visible', 'important');
                widget.style.setProperty('opacity', '1', 'important');
                widget.style.setProperty('position', 'fixed', 'important');
                widget.style.setProperty('z-index', '2147483647', 'important');
                widget.style.setProperty('pointer-events', 'auto', 'important');
            }
            if (btn) {
                btn.style.setProperty('display', 'flex', 'important');
                btn.style.setProperty('visibility', 'visible', 'important');
                btn.style.setProperty('opacity', '1', 'important');
            }
        }

        // 초기 강제 적용
        enforceStyles();

        // 100ms마다 스타일 강제 (매우 공격적)
        setInterval(enforceStyles, 100);

        // 5. 요소 참조 및 이벤트 연결
        setupWidgetEvents(shadowRoot);

        // 6. 감시 및 복구 시작
        startObserver();
    }

    function setupWidgetEvents(root) {
        const widget = root.querySelector('#sb-widget');
        const btn = root.querySelector('#sb-btn');
        const popup = root.querySelector('#sb-popup');
        const header = root.querySelector('#sb-header');
        const closeBtn = root.querySelector('#sb-close');
        const collectBtn = root.querySelector('#sb-collect');
        const dragBtn = root.querySelector('#sb-drag');
        const dashboardBtn = root.querySelector('#sb-dashboard');

        if (!widget || !popup) return;

        // Phase 7: 모드 선택기 참조
        const modeButtons = root.querySelectorAll('.sb-mode-btn');
        const modeDesc = root.querySelector('#sb-mode-desc');
        const progressContainer = root.querySelector('#sb-progress');
        const progressText = root.querySelector('#sb-progress-text');
        const progressCount = root.querySelector('#sb-progress-count');
        const progressFill = root.querySelector('#sb-progress-fill');

        // 상태
        let isOpen = false;
        let dragging = false;
        let dragType = null;
        let startX = 0, startY = 0, initX = 0, initY = 0;
        let currentMode = 'single'; // Phase 7: 현재 수집 모드

        // Phase 7: 모드별 설명 텍스트
        const modeDescriptions = {
            single: '현재 페이지의 상품 정보를 수집합니다',
            area: '드래그로 선택한 영역의 상품들을 수집합니다',
            page: '페이지의 모든 상품 링크를 추출하여 수집합니다',
            bulk: '전체 카테고리를 탐색하여 대량 수집합니다'
        };

        // Phase 7: 모드 전환 이벤트
        modeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                currentMode = mode;

                // 활성 상태 업데이트
                modeButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // 설명 업데이트
                if (modeDesc) {
                    modeDesc.querySelector('small').textContent = modeDescriptions[mode] || '';
                }
            });
        });

        // 위치 복원
        if (chrome && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get(['widgetPos'], (r) => {
                if (r.widgetPos) {
                    widget.style.left = r.widgetPos.left + 'px';
                    widget.style.top = r.widgetPos.top + 'px';
                    widget.style.right = 'auto';
                }
            });
        }

        // 통계 업데이트
        function updateStats() {
            if (chrome?.runtime?.sendMessage) {
                chrome.runtime.sendMessage({ action: 'getStats' }, (r) => {
                    if (r) {
                        const todayEl = root.querySelector('#sb-today');
                        const totalEl = root.querySelector('#sb-total');
                        if (todayEl) todayEl.textContent = r.today || 0;
                        if (totalEl) totalEl.textContent = r.total || 0;
                    }
                });
            }
        }

        // 팝업 제어
        const widgetControl = {
            open: () => {
                isOpen = true;
                popup.style.display = 'block';
                popup.classList.add('sb-enter');
                popup.classList.remove('sb-exit');
                popup.classList.add('active');
                btn.style.display = 'none';
                updateStats();
            },
            close: () => {
                isOpen = false;
                popup.classList.add('sb-exit');
                popup.classList.remove('sb-enter');
                popup.classList.remove('active');
                setTimeout(() => {
                    if (!isOpen) {
                        popup.style.display = 'none';
                        btn.style.display = 'flex';
                    }
                }, 200);
            }
        };

        // 드래그 로직
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

        // 전역 이벤트 (Shadow DOM 밖에서도 드래그가 끊기지 않도록 window에 연결)
        window.addEventListener('mousemove', (e) => {
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

        window.addEventListener('mouseup', (e) => {
            if (dragging && dragType === 'widget') {
                const moved = Math.abs(e.clientX - startX) > 5 || Math.abs(e.clientY - startY) > 5;
                dragging = false;
                dragType = null;
                btn.style.cursor = 'grab';

                const r = widget.getBoundingClientRect();
                chrome.storage.local.set({ widgetPos: { left: r.left, top: r.top } });

                if (!moved) widgetControl.open();
            } else if (dragging) {
                dragging = false;
                dragType = null;
                header.style.cursor = 'move';
            }
        });

        // 버튼 이벤트
        btn.addEventListener('mouseenter', () => !dragging && (btn.style.transform = 'scale(1.1)'));
        btn.addEventListener('mouseleave', () => !dragging && (btn.style.transform = 'scale(1)'));

        closeBtn.addEventListener('click', () => widgetControl.close());

        // Phase 7: 모드별 수집 로직
        collectBtn.addEventListener('click', async () => {
            collectBtn.innerHTML = '<span>⏳</span> 수집 중...';
            collectBtn.disabled = true;

            try {
                let result;

                // 모드에 따른 수집 로직 분기
                switch (currentMode) {
                    case 'single':
                        result = await collectSingle();
                        break;
                    case 'area':
                        result = await collectArea();
                        break;
                    case 'page':
                        result = await collectPage();
                        break;
                    case 'bulk':
                        result = await collectBulk();
                        break;
                    default:
                        result = await collectSingle();
                }

                // 성공 처리
                collectBtn.innerHTML = '<span>✓</span> 완료!';
                collectBtn.classList.add('success');
                setTimeout(() => {
                    collectBtn.innerHTML = '<span>🚀</span> 수집 시작';
                    collectBtn.classList.remove('success');
                    collectBtn.disabled = false;
                    updateStats();
                    hideProgress();
                }, 2000);

            } catch (e) {
                console.error('수집 실패:', e);
                collectBtn.innerHTML = '<span>✗</span> 실패';
                collectBtn.classList.add('error');
                alert('상품 수집 실패:\n' + e.message);
                setTimeout(() => {
                    collectBtn.innerHTML = '<span>🚀</span> 수집 시작';
                    collectBtn.classList.remove('error');
                    collectBtn.disabled = false;
                    hideProgress();
                }, 2000);
            }
        });

        // 진행률 표시 헬퍼 함수
        function showProgress() {
            if (progressContainer) {
                progressContainer.style.display = 'block';
            }
        }

        function hideProgress() {
            if (progressContainer) {
                progressContainer.style.display = 'none';
            }
        }

        function updateProgress(current, total, text = '수집 중...') {
            if (progressText) progressText.textContent = text;
            if (progressCount) progressCount.textContent = `${current}/${total}`;
            if (progressFill) {
                const percent = total > 0 ? (current / total) * 100 : 0;
                progressFill.style.width = `${percent}%`;
            }
        }

        // 모드별 수집 함수
        async function collectSingle() {
            // 단일 상품 수집
            if (typeof parserManager === 'undefined') {
                throw new Error('ParserManager not loaded');
            }

            const data = await parserManager.parseCurrentPage();

            return new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({ action: 'saveProduct', data }, (r) => {
                    if (r?.success) {
                        resolve(r);
                    } else {
                        reject(new Error(r?.error || '저장 실패'));
                    }
                });
            });
        }

        async function collectArea() {
            // 영역 선택 수집
            widgetControl.close();

            if (window.dragSelector) {
                return new Promise((resolve, reject) => {
                    window.dragSelector.toggle();
                    // drag-selector가 완료되면 resolve (실제 구현은 drag-selector.js에서)
                    setTimeout(() => resolve({ success: true, message: '영역 선택 모드 활성화' }), 500);
                });
            } else {
                throw new Error('영역 선택 기능이 로드되지 않았습니다');
            }
        }

        async function collectPage() {
            // 페이지 전체 링크 수집
            if (typeof parserManager === 'undefined') {
                throw new Error('ParserManager not loaded');
            }

            showProgress();
            updateProgress(0, 0, '링크 추출 중...');

            const links = await parserManager.collectLinks();
            if (!links || links.length === 0) {
                throw new Error('상품 링크를 찾을 수 없습니다');
            }

            updateProgress(0, links.length, '상품 수집 중...');

            let collected = 0;
            const results = [];

            for (let i = 0; i < links.length; i++) {
                try {
                    // 각 링크를 content script에 전달하여 수집
                    const result = await new Promise((resolve) => {
                        chrome.runtime.sendMessage({
                            action: 'collectFromUrl',
                            url: links[i]
                        }, resolve);
                    });

                    if (result?.success) {
                        collected++;
                        results.push(result);
                    }

                    updateProgress(i + 1, links.length, `수집 중... (${collected}/${links.length})`);

                    // 속도 제한
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (err) {
                    console.error('링크 수집 실패:', links[i], err);
                }
            }

            return { success: true, collected, total: links.length };
        }

        async function collectBulk() {
            // 몰털이 모드 (카테고리 재귀 탐색)
            showProgress();
            updateProgress(0, 0, '카테고리 분석 중...');

            // 현재 페이지의 카테고리 링크 수집
            const categoryLinks = await extractCategoryLinks();

            if (!categoryLinks || categoryLinks.length === 0) {
                throw new Error('카테고리 링크를 찾을 수 없습니다');
            }

            updateProgress(0, categoryLinks.length, '카테고리 탐색 중...');

            let totalCollected = 0;

            for (let i = 0; i < categoryLinks.length; i++) {
                try {
                    const categoryUrl = categoryLinks[i];
                    updateProgress(i, categoryLinks.length, `카테고리 ${i + 1}/${categoryLinks.length} 처리 중...`);

                    // 각 카테고리에서 상품 링크 수집 및 처리
                    const result = await chrome.runtime.sendMessage({
                        action: 'scrapCategory',
                        url: categoryUrl
                    });

                    if (result?.collected) {
                        totalCollected += result.collected;
                    }

                    // 속도 제한
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } catch (err) {
                    console.error('카테고리 처리 실패:', categoryLinks[i], err);
                }
            }

            return { success: true, collected: totalCollected, categories: categoryLinks.length };
        }

        async function extractCategoryLinks() {
            // 플랫폼별 카테고리 링크 추출 로직
            const links = [];
            const selectors = [
                'a[href*="/category/"]',
                'a[href*="/c/"]',
                '.category-link',
                '[data-category]',
                'nav a'
            ];

            selectors.forEach(selector => {
                document.querySelectorAll(selector).forEach(a => {
                    const href = a.href;
                    if (href && !links.includes(href)) {
                        links.push(href);
                    }
                });
            });

            return links.slice(0, 10); // 최대 10개 카테고리로 제한
        }

        dashboardBtn.addEventListener('click', () => {
            chrome.runtime.sendMessage({ action: 'openDashboard' });
        });

        // Storage 변경 감지
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName === 'local' && (changes.products || changes.stats)) {
                updateStats();
            }
        });
    }

    function startObserver() {
        // 호스트 요소가 삭제되면 즉시 복구
        const observer = new MutationObserver((mutations) => {
            if (!document.getElementById(HOST_ID)) {
                console.log('[셀러보드] ⚠️ 위젯 호스트 제거됨, 즉시 복구...');
                // 즉시 재추가
                if (hostElement && !document.body.contains(hostElement)) {
                    document.body.appendChild(hostElement);
                    console.log('[셀러보드] ✅ 위젯 재추가 완료');
                } else {
                    // 호스트가 없으면 완전히 재생성
                    initWidget();
                }
            }
        });

        // childList와 subtree 모두 감시
        observer.observe(document.body, {
            childList: true,
            subtree: false  // body의 직접 자식만 감시
        });

        // 더 빈번한 주기적 체크 (AliExpress 등 강력한 삭제 스크립트 대응)
        setInterval(() => {
            if (!document.getElementById(HOST_ID)) {
                console.log('[셀러보드] 🔄 주기적 체크 -> 위젯 복구');
                if (hostElement && !document.body.contains(hostElement)) {
                    document.body.appendChild(hostElement);
                } else {
                    initWidget();
                }
            }
        }, 500);  // 500ms마다 체크 (더 빈번하게)

        // 추가: 호스트를 body 맨 끝으로 지속적으로 이동
        setInterval(() => {
            if (hostElement && document.body.contains(hostElement)) {
                // 맨 끝으로 이동 (다른 요소들 뒤에 위치)
                document.body.appendChild(hostElement);
            }
        }, 1000);  // 1초마다 맨 끝으로 이동
    }

    // 실행
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWidget);
    } else {
        initWidget();
    }

})();
