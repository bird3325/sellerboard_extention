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
    // ParserManager는 manifest.json에서 먼저 로드되므로 global로 접근 가능
    if (typeof parserManager !== 'undefined') {
        parserManager.initialize();
    } else {
        console.error('ParserManager not loaded!');
    }
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
            case 'ping':
                // 연결 확인용
                sendResponse({ success: true });
                break;

            case 'getPageUrl':
                // 현재 페이지 URL 반환
                sendResponse({ url: window.location.href });
                break;

            case 'collectProduct':
            case 'trigger_product':
                // 상품 수집 (기존 및 새 액션명 모두 지원)
                handleCollectProduct(sendResponse);
                return true;

            case 'trigger_keyword':
                // 키워드 검색 페이지로 이동
                handleKeywordSearch(message.keyword, sendResponse);
                return true;

            case 'trigger_store':
                // 몰털이 (준비 중)
                sendResponse({ success: false, error: '몰털이 기능은 준비 중입니다.' });
                break;

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
    (async () => {
        try {
            console.log('상품 데이터 추출 시작 (V2.0)');

            if (typeof parserManager === 'undefined') {
                throw new Error('ParserManager not initialized');
            }

            const productData = await parserManager.parseCurrentPage();
            console.log('추출된 데이터:', productData);

            if (!productData.name && !productData.price) {
                console.error('상품 정보 없음');
                sendResponse({ success: false, error: '상품 정보를 찾을 수 없습니다.' });
                return;
            }

            // Service Worker로 데이터 전송하여 저장
            const saveResponse = await chrome.runtime.sendMessage({
                action: 'saveProduct',
                data: productData
            });

            if (saveResponse && saveResponse.success) {
                sendResponse({ success: true, message: '상품이 성공적으로 저장되었습니다.' });
            } else {
                sendResponse({ success: false, error: saveResponse?.error || '저장 실패' });
            }
        } catch (error) {
            console.error('상품 수집 오류:', error);
            sendResponse({ success: false, error: error.message });
        }
    })();
    return true; // 비동기 응답을 위해 true 반환
}

/**
 * 키워드 검색 처리
 */
function handleKeywordSearch(keyword, sendResponse) {
    if (!keyword) {
        sendResponse({ success: false, error: '키워드가 없습니다.' });
        return;
    }

    const host = window.location.hostname;
    let searchUrl = '';

    if (host.includes('aliexpress')) {
        searchUrl = `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(keyword)}`;
    } else if (host.includes('taobao')) {
        searchUrl = `https://s.taobao.com/search?q=${encodeURIComponent(keyword)}`;
    } else if (host.includes('1688')) {
        searchUrl = `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(keyword)}`;
    } else {
        sendResponse({ success: false, error: '지원하지 않는 사이트입니다.' });
        return;
    }

    window.location.href = searchUrl;
    sendResponse({ success: true, message: '검색 페이지로 이동 중...' });
}

/**
 * 상품 링크 추출 처리
 */
function handleGetProductLinks(sendResponse) {
    (async () => {
        try {
            if (typeof parserManager === 'undefined') {
                throw new Error('ParserManager not initialized');
            }

            const links = await parserManager.collectLinks();
            console.log('추출된 링크 수:', links.length);
            sendResponse({ success: true, links: links });
        } catch (error) {
            console.error('링크 추출 오류:', error);
            sendResponse({ success: false, error: error.message });
        }
    })();
    return true;
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




    });
}

/**
 * 동적 콘텐츠 감지 (SPA 페이지 전환)
 */
let lastUrl = location.href;
if (document.body) {
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
}
