/**
 * 셀러보드 플로팅 위젯 - 동그란 버튼 + 팝업
 */

class SellerboardWidget {
    constructor() {
        this.widget = null;
        this.popup = null;
        this.isPopupOpen = false;
        this.isDragging = false;
    }

    /**
     * 위젯 초기화
     */
    async init() {
        // 위젯 생성
        this.widget = document.createElement('div');
        this.widget.id = 'sellerboard-widget';
        this.widget.innerHTML = this.createFloatingButton();
        document.body.appendChild(this.widget);

        // 팝업 생성
        this.popup = document.createElement('div');
        this.popup.id = 'sellerboard-popup';
        this.popup.innerHTML = this.createPopupContent();
        this.popup.style.display = 'none';
        document.body.appendChild(this.popup);

        // 이벤트 리스너 연결
        this.attachEventListeners();

        // 위젯 위치 불러오기
        this.loadPosition();

        console.log('셀러보드 위젯 초기화 완료');
    }

    /**
     * Floating Button HTML
     */
    createFloatingButton() {
        return `
            <div class="sb-float-btn" id="sb-float-btn">
                <div class="sb-float-logo">S</div>
            </div>
        `;
    }

    /**
     * 팝업 HTML
     */
    createPopupContent() {
        return `
            <div class="sb-popup-container">
                <div class="sb-popup-header">
                    <div class="sb-popup-title">
                        <div class="sb-popup-logo">S</div>
                        셀러보드
                    </div>
                    <button class="sb-popup-close" id="sb-popup-close">✕</button>
                </div>

                <div class="sb-popup-body">
                    <!-- 기본 기능 버튼 -->
                    <div class="sb-button-group">
                        <button class="sb-btn primary" id="sb-collect-btn">
                            <span class="sb-btn-icon">📦</span>
                            상품 수집
                        </button>

                        <button class="sb-btn warning" id="sb-drag-mode-btn">
                            <span class="sb-btn-icon">🎯</span>
                            영역 드래그 선택
                        </button>
                    </div>

                    <!-- 상점 몰털이 토글 -->
                    <div class="sb-toggle-container">
                        <div class="sb-toggle-label">상점 몰털이</div>
                        <label class="sb-toggle-switch">
                            <input type="checkbox" class="sb-toggle-input" id="sb-store-mode-toggle">
                            <span class="sb-toggle-slider"></span>
                        </label>
                    </div>

                    <!-- 진행 상황 -->
                    <div class="sb-progress-container" id="sb-progress-container" style="display: none;">
                        <div class="sb-progress-text">
                            <span id="sb-progress-label">수집 중...</span>
                            <span class="sb-status-badge active" id="sb-progress-count">0 / 0</span>
                        </div>
                        <div class="sb-progress-bar">
                            <div class="sb-progress-fill" id="sb-progress-fill" style="width: 0%"></div>
                        </div>
                    </div>

                    <!-- 통계 -->
                    <div class="sb-stats-grid">
                        <div class="sb-stat-card">
                            <span class="sb-stat-number" id="sb-stat-today">0</span>
                            <span class="sb-stat-label">오늘 수집</span>
                        </div>
                        <div class="sb-stat-card">
                            <span class="sb-stat-number" id="sb-stat-total">0</span>
                            <span class="sb-stat-label">총 상품</span>
                        </div>
                    </div>

                    <!-- 설정 -->
                    <div class="sb-settings">
                        <div class="sb-settings-item">
                            <span class="sb-settings-label">대시보드</span>
                            <button class="sb-btn secondary" id="sb-dashboard-btn">
                                열기 →
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 이벤트 리스너 연결
     */
    attachEventListeners() {
        // Floating button 클릭
        document.getElementById('sb-float-btn')?.addEventListener('click', () => {
            this.togglePopup();
        });

        // 팝업 닫기
        document.getElementById('sb-popup-close')?.addEventListener('click', () => {
            this.closePopup();
        });

        // 상품 수집
        document.getElementById('sb-collect-btn')?.addEventListener('click', () => {
            this.collectCurrentProduct();
        });

        // 드래그 모드
        document.getElementById('sb-drag-mode-btn')?.addEventListener('click', () => {
            this.toggleDragMode();
        });

        // 상점 몰털이
        document.getElementById('sb-store-mode-toggle')?.addEventListener('change', (e) => {
            this.toggleStoreMode(e.target.checked);
        });

        // 대시보드 열기
        document.getElementById('sb-dashboard-btn')?.addEventListener('click', () => {
            this.openDashboard();
        });

        // 팝업 외부 클릭 시 닫기
        document.addEventListener('click', (e) => {
            if (this.isPopupOpen &&
                !this.popup.contains(e.target) &&
                !this.widget.contains(e.target)) {
                this.closePopup();
            }
        });

        // 드래그 기능
        const floatBtn = document.getElementById('sb-float-btn');
        floatBtn.addEventListener('mousedown', (e) => this.startDrag(e));
        document.addEventListener('mousemove', (e) => this.onDrag(e));
        document.addEventListener('mouseup', () => this.stopDrag());

        // 통계 업데이트
        this.updateStats();
    }

    /**
     * 팝업 토글
     */
    togglePopup() {
        if (this.isPopupOpen) {
            this.closePopup();
        } else {
            this.openPopup();
        }
    }

    /**
     * 팝업 열기
     */
    openPopup() {
        this.popup.style.display = 'block';
        this.isPopupOpen = true;
        this.positionPopup();
        this.updateStats();
    }

    /**
     * 팝업 닫기
     */
    closePopup() {
        this.popup.style.display = 'none';
        this.isPopupOpen = false;
    }

    /**
     * 팝업 위치 조정 (Floating button 근처에 표시)
     */
    positionPopup() {
        const btnRect = this.widget.getBoundingClientRect();
        const popupWidth = 320;
        const popupHeight = 500;

        let left = btnRect.right + 10;
        let top = btnRect.top;

        // 화면 오른쪽을 벗어나면 버튼 왼쪽에 표시
        if (left + popupWidth > window.innerWidth) {
            left = btnRect.left - popupWidth - 10;
        }

        // 화면 아래를 벗어나지 않도록
        if (top + popupHeight > window.innerHeight) {
            top = window.innerHeight - popupHeight - 20;
        }

        // 화면 위를 벗어나지 않도록
        if (top < 20) {
            top = 20;
        }

        this.popup.style.left = `${left}px`;
        this.popup.style.top = `${top}px`;
    }

    /**
     * 현재 페이지 상품 수집
     */
    async collectCurrentProduct() {
        const btn = document.getElementById('sb-collect-btn');
        btn.disabled = true;
        btn.innerHTML = '<span class="sb-btn-icon">⏳</span> 수집 중...';

        try {
            console.log('상품 데이터 추출 시작');
            const productData = await productParser.extractProductData();
            console.log('추출된 상품 데이터:', productData);

            if (!productData.name && !productData.price) {
                throw new Error('상품 정보를 찾을 수 없습니다');
            }

            chrome.runtime.sendMessage({
                action: 'saveProduct',
                data: productData
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('메시지 전송 오류:', chrome.runtime.lastError);
                    throw new Error(chrome.runtime.lastError.message);
                }

                if (response?.success) {
                    console.log('저장 성공!');
                    btn.innerHTML = '<span class="sb-btn-icon">✓</span> 수집 완료!';
                    btn.classList.add('success');
                    this.updateStats();

                    setTimeout(() => {
                        btn.classList.remove('success');
                        btn.innerHTML = '<span class="sb-btn-icon">📦</span> 상품 수집';
                        btn.disabled = false;
                    }, 2000);
                } else {
                    throw new Error(response?.error || '저장 실패');
                }
            });
        } catch (error) {
            console.error('상품 수집 실패:', error);
            btn.innerHTML = '<span class="sb-btn-icon">✗</span> ' + (error.message || '수집 실패');
            btn.classList.add('error');

            setTimeout(() => {
                btn.classList.remove('error');
                btn.innerHTML = '<span class="sb-btn-icon">📦</span> 상품 수집';
                btn.disabled = false;
            }, 3000);
        }
    }

    /**
     * 드래그 모드 토글
     */
    toggleDragMode() {
        if (window.dragSelector) {
            window.dragSelector.toggle();
        }
    }

    /**
     * 상점 몰털이 모드 토글
     */
    async toggleStoreMode(enabled) {
        if (enabled) {
            console.log('상점 몰털이 시작');
            const productLinks = productParser.extractProductLinks();
            console.log('추출된 상품 링크:', productLinks.length, '개');

            if (productLinks.length === 0) {
                alert('수집할 상품을 찾을 수 없습니다.');
                document.getElementById('sb-store-mode-toggle').checked = false;
                return;
            }

            chrome.runtime.sendMessage({
                action: 'startStoreScraping',
                links: productLinks
            });

            this.showProgress(0, productLinks.length);
        } else {
            chrome.runtime.sendMessage({ action: 'stopStoreScraping' });
            this.hideProgress();
        }
    }

    /**
     * 진행 상황 표시
     */
    showProgress(current, total) {
        const container = document.getElementById('sb-progress-container');
        const countEl = document.getElementById('sb-progress-count');
        const fillEl = document.getElementById('sb-progress-fill');

        container.style.display = 'block';
        countEl.textContent = `${current} / ${total}`;

        const percentage = total > 0 ? (current / total * 100) : 0;
        fillEl.style.width = `${percentage}%`;
    }

    /**
     * 진행 상황 숨기기
     */
    hideProgress() {
        const container = document.getElementById('sb-progress-container');
        container.style.display = 'none';
    }

    /**
     * 통계 업데이트
     */
    async updateStats() {
        chrome.runtime.sendMessage({ action: 'getStats' }, (response) => {
            if (response) {
                document.getElementById('sb-stat-today').textContent = response.today || 0;
                document.getElementById('sb-stat-total').textContent = response.total || 0;
            }
        });
    }

    /**
     * 대시보드 열기
     */
    openDashboard() {
        chrome.runtime.sendMessage({ action: 'openDashboard' });
    }

    /**
     * 위젯 드래그 시작
     */
    startDrag(e) {
        if (this.isPopupOpen) return; // 팝업 열려있으면 드래그 불가

        this.isDragging = true;
        const rect = this.widget.getBoundingClientRect();
        this.dragOffset = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
        e.preventDefault();
    }

    /**
     * 위젯 드래그 중
     */
    onDrag(e) {
        if (!this.isDragging) return;

        const x = e.clientX - this.dragOffset.x;
        const y = e.clientY - this.dragOffset.y;

        const maxX = window.innerWidth - this.widget.offsetWidth;
        const maxY = window.innerHeight - this.widget.offsetHeight;

        const boundedX = Math.max(0, Math.min(x, maxX));
        const boundedY = Math.max(0, Math.min(y, maxY));

        this.widget.style.left = `${boundedX}px`;
        this.widget.style.top = `${boundedY}px`;
        this.widget.style.right = 'auto';
        this.widget.style.bottom = 'auto';
    }

    /**
     * 위젯 드래그 종료
     */
    stopDrag() {
        if (this.isDragging) {
            this.isDragging = false;
            this.savePosition();
        }
    }

    /**
     * 위젯 위치 저장
     */
    savePosition() {
        const rect = this.widget.getBoundingClientRect();
        chrome.storage.local.set({
            widgetPosition: {
                left: rect.left,
                top: rect.top
            }
        });
    }

    /**
     * 위젯 위치 불러오기
     */
    loadPosition() {
        chrome.storage.local.get(['widgetPosition'], (result) => {
            if (result.widgetPosition) {
                this.widget.style.left = `${result.widgetPosition.left}px`;
                this.widget.style.top = `${result.widgetPosition.top}px`;
                this.widget.style.right = 'auto';
                this.widget.style.bottom = 'auto';
            }
        });
    }

    /**
     * 메시지 리스너 등록
     */
    setupMessageListener() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.action === 'updateProgress') {
                this.showProgress(message.current, message.total);
            } else if (message.action === 'scrapingComplete') {
                this.hideProgress();
                document.getElementById('sb-store-mode-toggle').checked = false;
                this.updateStats();

                const btn = document.getElementById('sb-collect-btn');
                btn.innerHTML = '<span class="sb-btn-icon">✓</span> 몰털이 완료!';
                btn.classList.add('success');

                setTimeout(() => {
                    btn.classList.remove('success');
                    btn.innerHTML = '<span class="sb-btn-icon">📦</span> 상품 수집';
                }, 3000);
            }
        });
    }
}

// 위젯 초기화
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', async () => {
        const widget = new SellerboardWidget();
        await widget.init();
        widget.setupMessageListener();
        window.sellerboardWidget = widget;
    });
} else {
    (async () => {
        const widget = new SellerboardWidget();
        await widget.init();
        widget.setupMessageListener();
        window.sellerboardWidget = widget;
    })();
}
