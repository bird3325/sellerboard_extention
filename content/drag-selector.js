/**
 * 영역 드래그 선택 기능
 */

class DragSelector {
    constructor() {
        this.isActive = false;
        this.isSelecting = false;
        this.startX = 0;
        this.startY = 0;
        this.overlay = null;
        this.svg = null;
        this.selectionRect = null;
        this.selectedElements = [];
        this.dimmer = null;
        this.instruction = null;
        this.counter = null;
    }

    /**
     * 드래그 모드 토글
     */
    toggle() {
        if (this.isActive) {
            this.deactivate();
        } else {
            this.activate();
        }
    }

    /**
     * 드래그 모드 활성화
     */
    activate() {
        this.isActive = true;
        this.createOverlay();
        this.showInstruction();
        this.showDimmer();

        // 위젯 버튼 상태 업데이트
        const btn = document.getElementById('sb-drag-mode-btn');
        if (btn) {
            btn.innerHTML = '<span class="sb-btn-icon">✓</span> 선택 모드 활성';
            btn.classList.add('success');
        }
    }

    /**
     * 드래그 모드 비활성화
     */
    deactivate() {
        this.isActive = false;
        this.removeOverlay();
        this.hideInstruction();
        this.hideDimmer();
        this.hideCounter();
        this.clearSelection();

        // 위젯 버튼 상태 업데이트
        const btn = document.getElementById('sb-drag-mode-btn');
        if (btn) {
            btn.innerHTML = '<span class="sb-btn-icon">🎯</span> 영역 드래그 선택';
            btn.classList.remove('success');
        }
    }

    /**
     * 오버레이 생성
     */
    createOverlay() {
        if (this.overlay) return;

        // SVG 오버레이
        this.overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.overlay.id = 'sellerboard-drag-overlay';
        this.overlay.classList.add('active');
        this.overlay.style.position = 'fixed';
        this.overlay.style.top = '0';
        this.overlay.style.left = '0';
        this.overlay.style.width = '100%';
        this.overlay.style.height = '100%';
        this.overlay.style.zIndex = '999998';
        this.overlay.style.pointerEvents = 'all';
        this.overlay.style.cursor = 'crosshair';

        document.body.appendChild(this.overlay);

        // 이벤트 리스너
        this.overlay.addEventListener('mousedown', (e) => this.startSelection(e));
        this.overlay.addEventListener('mousemove', (e) => this.updateSelection(e));
        this.overlay.addEventListener('mouseup', (e) => this.endSelection(e));
    }

    /**
     * 오버레이 제거
     */
    removeOverlay() {
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
            this.svg = null;
            this.selectionRect = null;
        }
    }

    /**
     * 선택 시작
     */
    startSelection(e) {
        this.isSelecting = true;
        this.startX = e.clientX;
        this.startY = e.clientY;

        // 선택 직사각형 생성
        this.selectionRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        this.selectionRect.classList.add('sb-selection-rect');
        this.selectionRect.setAttribute('x', this.startX);
        this.selectionRect.setAttribute('y', this.startY);
        this.selectionRect.setAttribute('width', '0');
        this.selectionRect.setAttribute('height', '0');

        this.overlay.appendChild(this.selectionRect);
        this.hideInstruction();
    }

    /**
     * 선택 업데이트
     */
    updateSelection(e) {
        if (!this.isSelecting) return;

        const currentX = e.clientX;
        const currentY = e.clientY;

        const x = Math.min(this.startX, currentX);
        const y = Math.min(this.startY, currentY);
        const width = Math.abs(currentX - this.startX);
        const height = Math.abs(currentY - this.startY);

        this.selectionRect.setAttribute('x', x);
        this.selectionRect.setAttribute('y', y);
        this.selectionRect.setAttribute('width', width);
        this.selectionRect.setAttribute('height', height);

        // 실시간으로 선택된 요소 하이라이트
        this.highlightIntersectingElements(x, y, width, height);
    }

    /**
     * 선택 종료
     */
    async endSelection(e) {
        if (!this.isSelecting) return;

        this.isSelecting = false;

        if (this.selectedElements.length > 0) {
            // 선택된 상품 수집
            await this.collectSelectedProducts();
        }

        // 선택 영역 제거
        if (this.selectionRect) {
            this.selectionRect.remove();
            this.selectionRect = null;
        }

        // 모드 비활성화
        this.deactivate();
    }

    /**
     * 교차하는 요소 하이라이트
     */
    highlightIntersectingElements(x, y, width, height) {
        // 이전 하이라이트 제거
        this.clearSelection();

        // 상품 카드 감지
        const productCards = productParser.detectProductCards();

        const selectionRect = {
            left: x,
            top: y,
            right: x + width,
            bottom: y + height
        };

        productCards.forEach(card => {
            const rect = card.getBoundingClientRect();
            const cardRect = {
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom
            };

            // 교차 검사
            if (this.rectsIntersect(selectionRect, cardRect)) {
                card.classList.add('sb-product-highlight');
                this.selectedElements.push(card);
            }
        });

        // 카운터 업데이트
        this.updateCounter(this.selectedElements.length);
    }

    /**
     * 직사각형 교차 검사
     */
    rectsIntersect(rect1, rect2) {
        return !(
            rect1.right < rect2.left ||
            rect1.left > rect2.right ||
            rect1.bottom < rect2.top ||
            rect1.top > rect2.bottom
        );
    }

    /**
     * 선택 해제
     */
    clearSelection() {
        this.selectedElements.forEach(el => {
            el.classList.remove('sb-product-highlight');
        });
        this.selectedElements = [];
    }

    /**
     * 선택된 상품 수집
     */
    async collectSelectedProducts() {
        const products = [];

        for (const element of this.selectedElements) {
            // 각 상품 카드에서 링크 추출
            const links = productParser.extractProductLinks(element);
            if (links.length > 0) {
                products.push(links[0]); // 첫 번째 링크만 사용
            }
        }

        if (products.length === 0) {
            alert('선택한 영역에서 상품을 찾을 수 없습니다.');
            return;
        }

        // 백그라운드로 전송
        chrome.runtime.sendMessage({
            action: 'startStoreScraping',
            links: products
        });

        // 위젯에 알림
        if (window.sellerboardWidget) {
            window.sellerboardWidget.showProgress(0, products.length);
        }
    }

    /**
     * 안내 메시지 표시
     */
    showInstruction() {
        if (this.instruction) return;

        this.instruction = document.createElement('div');
        this.instruction.className = 'sb-drag-instruction';
        this.instruction.innerHTML = '<span class="icon">🎯</span> 마우스로 드래그하여 상품을 선택하세요';
        document.body.appendChild(this.instruction);

        // 3초 후 자동 숨김
        setTimeout(() => {
            this.hideInstruction();
        }, 3000);
    }

    /**
     * 안내 메시지 숨김
     */
    hideInstruction() {
        if (this.instruction) {
            this.instruction.remove();
            this.instruction = null;
        }
    }

    /**
     * 배경 디밍 표시
     */
    showDimmer() {
        if (this.dimmer) return;

        this.dimmer = document.createElement('div');
        this.dimmer.className = 'sb-drag-dimmer';
        document.body.appendChild(this.dimmer);
    }

    /**
     * 배경 디밍 숨김
     */
    hideDimmer() {
        if (this.dimmer) {
            this.dimmer.remove();
            this.dimmer = null;
        }
    }

    /**
     * 선택 카운터 표시
     */
    updateCounter(count) {
        if (!this.counter && count > 0) {
            this.counter = document.createElement('div');
            this.counter.className = 'sb-selection-counter';
            document.body.appendChild(this.counter);
        }

        if (this.counter) {
            this.counter.innerHTML = `선택된 상품: <span class="count">${count}</span>개`;
        }
    }

    /**
     * 선택 카운터 숨김
     */
    hideCounter() {
        if (this.counter) {
            this.counter.remove();
            this.counter = null;
        }
    }
}

// 전역 인스턴스
const dragSelector = new DragSelector();
window.dragSelector = dragSelector;
