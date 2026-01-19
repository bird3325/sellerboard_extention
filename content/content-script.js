/**
 * Content Script - 메시지 중계 및 초기화
 */



// 1. [Relay] 웹 페이지(Dashboard)에서 오는 메시지를 받아 Background로 전달 (Connection Error 해결책)
window.addEventListener("message", (event) => {
    // 보안: 신뢰할 수 있는 소스인지 확인 (여기서는 단순히 소스 태그 체크)
    if (event.data?.source === 'SELLERBOARD_WEB' && (event.data?.type === 'SCRAPE_PRODUCT' || event.data?.type === 'SCRAPE_PRODUCT_RELAY')) {
        console.log("[Content] Relaying SCRAPE_PRODUCT to Background:", event.data.payload);

        // Background로 전달 (내부 메시징이므로 externally_connectable 불필요)
        // 기존 컨벤션(action)과 새 컨벤션(type) 모두 호환되도록 전송
        chrome.runtime.sendMessage({
            action: 'SCRAPE_PRODUCT',
            type: 'SCRAPE_PRODUCT',
            payload: event.data.payload
        }, (response) => {
            console.log("[Content] Background Response:", response);
            // 필요시 웹 페이지로 다시 응답을 돌려줄 수 있음
        });
    }
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initContentScript);
} else {
    initContentScript();
}

function initContentScript() {

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
                handleCollectProduct(message.collection_type || 'single', sendResponse);
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

            case 'collectSearchResults':
                handleCollectSearchResults(message, sendResponse);
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

            case "EXT_SCRAPE_NOW":
                (async () => {
                    try {
                        if (typeof parserManager === 'undefined') {
                            throw new Error('ParserManager not initialized');
                        }
                        const data = await parserManager.parseCurrentPage();
                        sendResponse(data);
                    } catch (e) {
                        console.error("Auto Scrape Error:", e);
                        sendResponse({ error: e.message });
                    }
                })();
                return true; // Async response
        }
    });
}

/**
 * 상품 수집 처리
 */
/**
 * 에러 모달 표시
 */
function showErrorModal(title, message) {
    // 기존 모달 제거
    const existingModal = document.querySelector('.sb-modal-overlay');
    if (existingModal) existingModal.remove();

    const icons = {
        error: '🚫',
        info: 'ℹ️'
    };

    const modalHtml = `
        <div class="sb-modal-overlay">
            <div class="sb-modal-content">
                <span class="sb-modal-icon">${icons.error}</span>
                <span class="sb-modal-title">${title}</span>
                <span class="sb-modal-message">${message}</span>
                <button class="sb-modal-btn">확인</button>
            </div>
        </div>
    `;

    const div = document.createElement('div');
    div.innerHTML = modalHtml;
    const modal = div.firstElementChild;

    // 버튼 이벤트
    const btn = modal.querySelector('.sb-modal-btn');
    btn.onclick = () => {
        modal.style.opacity = '0';
        setTimeout(() => modal.remove(), 200);
    };

    // 배경 클릭 시 닫기
    modal.onclick = (e) => {
        if (e.target === modal) {
            btn.click();
        }
    };

    if (document.body) {
        document.body.appendChild(modal);
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            document.body.appendChild(modal);
        });
    }
}

/**
 * 상품 수집 처리
 */
function handleCollectProduct(collectionType, sendResponse) {
    (async () => {
        try {
            if (typeof parserManager === 'undefined') {
                throw new Error('ParserManager not initialized');
            }

            const productData = await parserManager.parseCurrentPage();

            if (!productData.name && !productData.price) {
                console.error('상품 정보 없음');
                showErrorModal('수집 실패', '상품 정보를 찾을 수 없습니다.');
                sendResponse({ success: false, error: '상품 정보를 찾을 수 없습니다.' });
                return;
            }

            // Service Worker로 데이터 전송하여 저장
            const saveResponse = await chrome.runtime.sendMessage({
                action: 'saveProduct',
                data: {
                    ...productData,
                    collection_type: collectionType
                }
            });

            if (saveResponse && saveResponse.success) {
                sendResponse({ success: true, message: '상품이 성공적으로 저장되었습니다.' });
            } else {
                // 에러 모달 표시 (수집 불가 메시지 등)
                const errorMsg = saveResponse?.error || '저장 실패';

                // [수집 불가] prefix가 있는 경우만 모달을 띄우거나, 전체 에러에 대해 띄울 수 있음.
                // 사용자 요청 컨텍스트상 '차단' 케이스가 중요하므로 모든 에러를 모달로 처리
                showErrorModal('수집 실패', errorMsg);

                sendResponse({ success: false, error: errorMsg });
            }
        } catch (error) {
            console.error('상품 수집 오류:', error);
            showErrorModal('수집 오류', error.message);
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

            sendResponse({ success: true, links: links });
        } catch (error) {
            console.error('링크 추출 오류:', error);
            sendResponse({ success: false, error: error.message });
        }
    })();
    return true;
}

/**
 * 검색 결과 수집 처리
 */
function handleCollectSearchResults(message, sendResponse) {
    (async () => {
        try {
            if (typeof parserManager === 'undefined') {
                throw new Error('ParserManager not initialized');
            }

            const filters = message.filters || {};
            const results = await parserManager.collectSearchResults(filters);

            // 결과가 없으면 잠시 대기 후 재시도 (렌더링 딜레이 대응)
            if (!results || results.length === 0) {
                await new Promise(r => setTimeout(r, 2000));
                const retryResults = await parserManager.collectSearchResults(filters);
                sendResponse({ success: true, items: retryResults });
            } else {
                sendResponse({ success: true, items: results });
            }

        } catch (error) {
            console.error('검색 결과 수집 오류:', error);
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


            if (window.sellerboardWidget) {
                window.sellerboardWidget.updateStats();
            }
        }
    }).observe(document.body, {
        subtree: true,
        childList: true
    });
}

function scrapePage() {
    // 1. 기본 정보 추출 (범용 선택자)
    const title = document.querySelector('h1')?.innerText || document.title;

    // 2. 이미지 추출 (og:image 또는 대표 이미지)
    let images = [];
    const ogImage = document.querySelector('meta[property="og:image"]')?.content;
    if (ogImage) images.push(ogImage);

    document.querySelectorAll('img').forEach(img => {
        if (img.width > 200 && img.height > 200) images.push(img.src);
    });
    images = [...new Set(images)].slice(0, 5); // 중복제거 & 상위 5개
    // 3. 가격 (옵션별 최저가 등)
    // 사이트별 커스텀 로직이 필요할 수 있음 (알리, 타오바오 등)

    // 기존 ParserManager가 있다면 활용 시도 (선택적)
    // if (typeof parserManager !== 'undefined') { ... }

    return {
        title: title,
        images: images,
        description: document.body.innerText.substring(0, 200), // 간략 설명
        url: window.location.href
    };
}
