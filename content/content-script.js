/**
 * Content Script - 메시지 중계 및 초기화
 */

console.log('셀러보드 Content Script 로드 시작');

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initContentScript);
} else {
    initContentScript();
}

function initContentScript() {
    console.log('셀러보드 Content Script 초기화 완료');
    setupMessageListeners();
    setupKeyboardShortcuts();
}

/**
 * 메시지 리스너 설정
 */
function setupMessageListeners() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log('Content Script 메시지 수신:', message.action);

        switch (message.action) {
            case 'collectProduct':
                handleCollectProduct(sendResponse);
                return true;

            case 'getProductLinks':
                handleGetProductLinks(sendResponse);
                return true;

            case 'updateProgress':
                if (window.sellerboardWidget) {
                    window.sellerboardWidget.showProgress(message.current, message.total);
                }
                break;

            case 'scrapingComplete':
                if (window.sellerboardWidget) {
                    window.sellerboardWidget.hideProgress();
                    const toggle = document.getElementById('sb-store-mode-toggle');
                    if (toggle) toggle.checked = false;
                    window.sellerboardWidget.updateStats();
                }
                break;
        }
    });
}

/**
 * 상품 수집 처리
 */
function handleCollectProduct(sendResponse) {
    try {
        console.log('상품 데이터 추출 시작');
        const productData = productParser.extractProductData();
        console.log('추출된 데이터:', productData);

        if (!productData.name && !productData.price) {
            console.error('상품 정보 없음');
            sendResponse({ success: false, error: '상품 정보를 찾을 수 없습니다.' });
            return;
        }

        sendResponse({ success: true, data: productData });
    } catch (error) {
        console.error('상품 수집 오류:', error);
        sendResponse({ success: false, error: error.message });
    }
}

/**
 * 상품 링크 추출 처리
 */
function handleGetProductLinks(sendResponse) {
    try {
        const links = productParser.extractProductLinks();
        console.log('추출된 링크 수:', links.length);
        sendResponse({ success: true, links: links });
    } catch (error) {
        console.error('링크 추출 오류:', error);
        sendResponse({ success: false, error: error.message });
    }
}

/**
 * 키보드 단축키 설정
 */
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.altKey && e.key === 's') {
            e.preventDefault();
            if (window.sellerboardWidget) {
                console.log('단축키: 상품 수집');
                window.sellerboardWidget.collectCurrentProduct();
            }
        }

        if (e.altKey && e.key === 'd') {
            e.preventDefault();
            if (window.dragSelector) {
                console.log('단축키: 드래그 모드');
                window.dragSelector.toggle();
            }
        }

        if (e.key === 'Escape') {
            if (window.dragSelector && window.dragSelector.isActive) {
                console.log('단축키: 드래그 모드 해제');
                window.dragSelector.deactivate();
            }
        }
    });
}

/**
 * 동적 콘텐츠 감지 (SPA 페이지 전환)
 */
let lastUrl = location.href;
new MutationObserver(() => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        console.log('페이지 변경 감지:', currentUrl);

        if (window.sellerboardWidget) {
            window.sellerboardWidget.updateStats();
        }
    }
}).observe(document.body, {
    subtree: true,
    childList: true
});
