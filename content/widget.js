/**
 * 셀러보드 위젯 - 인페이지 플로팅 UI
 */

class SellerboardWidget {
    constructor() {
        this.widget = null;
        this.isMinimized = false;
        this.isDragging = false;
        return `
      <div class="sb-widget-container">
        <div class="sb-widget-header">
          <div class="sb-widget-title">
            <div class="sb-widget-logo">S</div>
            셀러보드
          </div>
          <div class="sb-widget-controls">
            <button class="sb-widget-btn-header" id="sb-minimize-btn" title="최소화">−</button>
            <button class="sb-widget-btn-header" id="sb-settings-btn" title="설정">⚙</button>
          </div>
        </div>
        
        <div class="sb-widget-body">
          <!-- 기본 기능 버튼 -->
          <div class="sb-button-group">
            <button class="sb-btn" id="sb-collect-btn">
              <span class="sb-btn-icon">📦</span>
              상품 수집
            </button>
            
            <button class="sb-btn warning" id="sb-drag-mode-btn">
              <span class="sb-btn-icon">🎯</span>
              영역 드래그 선택
            </button>
          </div>

          <!-- 상점 몰털이 토글 -->
          <div class="sb-toggle-container" style="margin-top: 12px;">
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
          <div class="sb-stats-grid" style="margin-top: 12px;">
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
              <button class="sb-btn" id="sb-dashboard-btn" style="padding: 6px 12px; font-size: 12px;">
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
        document.getElementById('sb-minimize-btn')?.addEventListener('click', () => {
            this.toggleMinimize();
        });

        document.getElementById('sb-settings-btn')?.addEventListener('click', () => {
            this.openDashboard();
        });

        document.getElementById('sb-collect-btn')?.addEventListener('click', () => {
            this.collectCurrentProduct();
        });

        document.getElementById('sb-drag-mode-btn')?.addEventListener('click', () => {
            this.toggleDragMode();
        });

        document.getElementById('sb-store-mode-toggle')?.addEventListener('change', (e) => {
            this.toggleStoreMode(e.target.checked);
        });

        document.getElementById('sb-dashboard-btn')?.addEventListener('click', () => {
            this.openDashboard();
        });

        const header = this.widget.querySelector('.sb-widget-header');
        header.addEventListener('mousedown', (e) => this.startDrag(e));
        document.addEventListener('mousemove', (e) => this.onDrag(e));
        document.addEventListener('mouseup', () => this.stopDrag());

        this.updateStats();
    }

    /**
     * 최소화/복원 토글
     */
    toggleMinimize() {
        this.isMinimized = !this.isMinimized;
        const container = this.widget.querySelector('.sb-widget-container');
        const body = this.widget.querySelector('.sb-widget-body');
        const btn = document.getElementById('sb-minimize-btn');

        if (this.isMinimized) {
            container.classList.add('minimized');
            body.classList.add('hidden');
            btn.textContent = '+';
        } else {
            container.classList.remove('minimized');
            body.classList.remove('hidden');
            btn.textContent = '−';
        }
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
            const productData = productParser.extractProductData();
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
            btn.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';

            setTimeout(() => {
                btn.style.background = '';
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
        this.isStoreMode = enabled;

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

        this.progress = { current, total };
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
        if (e.target.closest('.sb-widget-btn-header')) return;

        this.isDragging = true;
        const rect = this.widget.getBoundingClientRect();
        this.dragOffset = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
        this.widget.style.transition = 'none';
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
            this.widget.style.transition = '';
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
    } else {
    throw new Error(response?.error || '저장 실패');
}
            });
        } catch (error) {
    console.error('상품 수집 실패:', error);
    btn.innerHTML = '<span class="sb-btn-icon">✗</span> ' + (error.message || '수집 실패');
    btn.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';

    setTimeout(() => {
        btn.style.background = '';
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
    this.isStoreMode = enabled;

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

    this.progress = { current, total };
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
    if (e.target.closest('.sb-widget-btn-header')) return;

    this.isDragging = true;
    const rect = this.widget.getBoundingClientRect();
    this.dragOffset = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
    this.widget.style.transition = 'none';
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
        this.widget.style.transition = '';
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
