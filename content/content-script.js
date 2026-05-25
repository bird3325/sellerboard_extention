/**
 * Content Script - 메시지 중계 및 초기화
 */



// 1. [Relay] 웹 페이지(Dashboard)에서 오는 메시지를 받아 Background로 전달 (Connection Error 해결책)
if (typeof window.SellerboardContentScriptInitialized === 'undefined') {
    window.SellerboardContentScriptInitialized = true;

    window.addEventListener("message", (event) => {
        // 보안: 신뢰할 수 있는 소스인지 확인 (여기서는 단순히 소스 태그 체크)
        if (event.data?.source === 'SELLERBOARD_WEB' && (event.data?.type === 'SCRAPE_PRODUCT' || event.data?.type === 'SCRAPE_PRODUCT_RELAY')) {
            console.log("[Content] Relaying SCRAPE_PRODUCT to Background:", event.data.payload);

            // Background로 전달 (내부 메시징이므로 externally_connectable 불필요)
            // 기존 컨벤션(action)과 새 컨벤션(type) 모두 호환되도록 전송
            const payload = event.data.payload || {};
            // 웹에서 온 요청은 기본적으로 'work'로 처리
            if (!payload.collection_type) {
                payload.collection_type = 'work';
            }

            chrome.runtime.sendMessage({
                action: 'SCRAPE_PRODUCT',
                type: 'SCRAPE_PRODUCT',
                payload: payload
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
        checkAndInitCartIcons();
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
                    // [ASYNC RESPONSE] 즉시 응답하여 타임아웃 방지
                    sendResponse({ status: 'started' });

                    (async () => {
                        try {
                            const data = await executeScraping();

                            // [SKIPPED] 수집 제외 처리
                            if (data.skipped) {
                                console.log('[Content] 상품 수집이 제외되었습니다:', data.reason);
                                chrome.runtime.sendMessage({
                                    action: 'AUTO_SCRAPE_DONE',
                                    data: data
                                });
                                return;
                            }

                            console.log("[Content] Verified Description Length:", data.description ? data.description.length : 0);

                            // [ASYNC COMPLETION] 수집 완료 메시지 전송
                            chrome.runtime.sendMessage({
                                action: 'AUTO_SCRAPE_DONE',
                                data: data
                            });
                        } catch (e) {

                            console.error("Auto Scrape Error:", e);
                            // [ASYNC ERROR] 에러 메시지 전송
                            chrome.runtime.sendMessage({
                                action: 'AUTO_SCRAPE_ERROR',
                                error: e.message
                            });
                        }
                    })();
                    return true; // Keep channel open (optional due to immediate response, but good for safety)
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
     * 상품 수집 처리 (공통 로직)
     */
    async function executeScraping() {
        if (typeof parserManager === 'undefined') {
            throw new Error('ParserManager not initialized');
        }

        const data = await parserManager.parseCurrentPage();

        // [VALIDATION] 상품 정보 유효성 검사
        if (!data.name && !data.price) {
            throw new Error('상품 정보를 찾을 수 없습니다. (Name/Price missing)');
        }

        return data;
    }

    /**
     * 상품 수집 처리 (수동 버튼)
     */
    function handleCollectProduct(collectionType, sendResponse) {
        (async () => {
            try {
                const productData = await executeScraping();

                if (productData.skipped) {
                    console.log('상품 수집이 제외되었습니다:', productData.reason);
                    showErrorModal('수집 제외', productData.reason || '수집이 제외된 상품입니다.');
                    sendResponse({ success: false, skipped: true, error: productData.reason });
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
                    const errorMsg = saveResponse?.error || '저장 실패';
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

    /**
     * 플랫폼 활성화 여부 확인 및 담기 아이콘 초기화
     */
    async function checkAndInitCartIcons() {
        const platform = PlatformDetector.detect();
        if (!platform || platform === 'generic') return;

        try {
            chrome.runtime.sendMessage({
                action: 'checkPlatformActive',
                platformId: platform
            }, (response) => {
                if (response && response.isActive) {
                    setupCartIconsObserver();
                }
            });
        } catch (e) {
            console.error('[Content] checkPlatformActive failed:', e);
        }
    }

    function isProductLink(h) {
        if (!h) return false;

        // 알리익스프레스(aliexpress.com) 상품 링크 판단 완화
        if (h.includes('aliexpress.com')) {
            return h.includes('/item/') || 
                   h.includes('/product/') || 
                   h.includes('/products/') || 
                   h.includes('/goods/') || 
                   h.includes('detail.html') ||
                   /\d{10,20}\.html/.test(h) ||
                   (h.includes('productId=') && /\d{10,20}/.test(h));
        }

        return (
            h.includes('/item/') ||
            h.includes('/product/') ||
            h.includes('/goods/') ||
            h.includes('/products/') ||
            (h.includes('smartstore.naver.com') && h.includes('/products/'))
        );
    }

    // 글로벌 CSS 스타일 주입 (가려진 영역으로 인한 mouseenter 오작동 해결)
    if (!document.getElementById('sb-cart-style')) {
        const style = document.createElement('style');
        style.id = 'sb-cart-style';
        style.textContent = `
            .sb-cart-container { position: relative !important; }
            .sb-cart-container:hover .sb-cart-btn { opacity: 1 !important; z-index: 999999 !important; }
            .sb-cart-btn { opacity: 0; transition: opacity 0.2s ease, transform 0.2s ease !important; }
            .sb-cart-btn:hover { transform: scale(1.2) !important; }
            .sb-cart-btn.sb-contained { opacity: 0.3 !important; }
            .sb-cart-container:hover .sb-cart-btn.sb-contained { opacity: 0.3 !important; }
        `;
        document.head.appendChild(style);
    }

    function injectCartIcons() {
        const productLinks = document.querySelectorAll('a[href]');
        productLinks.forEach(a => {
            const h = a.href;
            if (!isProductLink(h)) return;

            // 이미 아이콘이 삽입되어 있다면 패스
            if (a.querySelector('.sb-cart-btn') || a.classList.contains('sb-cart-processed')) return;

            // 이미지 찾기 휴리스틱 (알리 SuperDeals 등 템플릿 대응)
            let img = a.querySelector('img');
            let imgContainer = a;

            const card = a.closest('div[class*="item"], li, div[class*="card"], div[class*="product"], div[class*="subject"], div[class*="goods"]');
            if (!img && card) {
                img = card.querySelector('img');
                if (img) {
                    imgContainer = a.offsetHeight > 30 ? a : card;
                }
            }

            // [구제책] 알리 특가 페이지 등에서 이미지가 가려져서 전혀 안 뽑히는 경우에도
            // card의 크기 또는 a 태그 자체의 크기가 충분히 크면(가로 60px & 세로 60px 이상) 
            // 상품 카드로 간주하고 a 태그 자체를 imgContainer로 지정하여 아이콘을 무조건 주입합니다.
            const rect = a.getBoundingClientRect();
            const isLargeClickArea = rect.width > 60 && rect.height > 60;
            if (!img && !isLargeClickArea && (!card || card.offsetHeight < 40)) {
                return; // 텍스트 링크 방지용 최후의 수단
            }

            a.classList.add('sb-cart-processed');
            imgContainer.classList.add('sb-cart-container');

            // 겹침 배치를 위한 포지션 세팅
            const computedStyle = window.getComputedStyle(imgContainer);
            if (computedStyle.position === 'static') {
                imgContainer.style.position = 'relative';
            }

            // 담기 버튼 생성
            const btn = document.createElement('button');
            btn.className = 'sb-cart-btn';
            const logoUrl = chrome.runtime.getURL('assets/icons/icon48.png');
            btn.innerHTML = `<img src="${logoUrl}" style="width: 24px; height: 24px; display: block; pointer-events: none;">`;
            btn.title = '담기 수집 목록에 추가';
            
            // 인라인 스타일 적용 (UI 및 스타일 불간섭 원칙)
            Object.assign(btn.style, {
                position: 'absolute',
                top: '8px',
                right: '8px',
                zIndex: '99999',
                background: 'transparent',
                border: 'none',
                width: '28px',
                height: '28px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0',
            });

            // 이미 담겨 있는 URL인지 체크하여 초기 상태 적용
            chrome.storage.local.get({ cart_items: [] }, (result) => {
                const isContained = result.cart_items.some(item => 
                    (typeof item === 'object' && item !== null) ? item.url === h : item === h
                );
                if (isContained) {
                    btn.classList.add('sb-contained');
                    btn.title = '이미 담겼습니다';
                }
            });

            // 클릭 이벤트
            btn.onclick = async (e) => {
                e.preventDefault();
                e.stopPropagation();

                // 해외 쇼핑몰인데 원화(KRW)로 설정되어 있는지 검사
                const platform = PlatformDetector.detect();
                const isKorean = PlatformDetector.isKoreanPlatform(platform);
                
                if (!isKorean) {
                    const priceText = imgContainer.textContent || a.textContent || '';
                    const isWon = priceText.includes('₩') || priceText.includes('원') || priceText.toUpperCase().includes('KRW');
                    
                    if (isWon) {
                        showErrorModal('통화 설정 변경 안내', '현재 상품 가격이 원화(KRW)로 설정되어 있습니다.<br><br>해외 소싱 상품은 정확한 수집과 이중 환전 수수료 방지를 위해 쇼핑몰 설정에서 <b>통화를 달러(USD)로 변경</b> 후 다시 시도해 주세요.');
                        return; // 담기 중단
                    }
                }

                const result = await chrome.storage.local.get({ cart_items: [] });
                const cartItems = result.cart_items;
                const isContained = cartItems.some(item => 
                    (typeof item === 'object' && item !== null) ? item.url === h : item === h
                );

                if (isContained) {
                    // 이미 존재하면 제거 (토글)
                    const newCartItems = cartItems.filter(item => {
                        const itemUrl = (typeof item === 'object' && item !== null) ? item.url : item;
                        return itemUrl !== h;
                    });
                    await chrome.storage.local.set({ cart_items: newCartItems });
                    btn.classList.remove('sb-contained');
                    btn.title = '담기 수집 목록에 추가';
                    showToast('담기 해제되었습니다.');
                } else {
                    // 추가
                    const imgSrc = img ? (img.src || img.dataset.src || '') : '';
                    cartItems.push({ url: h, imageUrl: imgSrc });
                    await chrome.storage.local.set({ cart_items: cartItems });
                    btn.classList.add('sb-contained');
                    btn.title = '이미 담겼습니다';
                    showToast('담기 수집 목록에 추가되었습니다.');
                }
            };

            imgContainer.appendChild(btn);
        });
    }

    function showToast(message) {
        const existing = document.querySelector('.sb-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'sb-toast';
        toast.innerText = message;
        
        Object.assign(toast.style, {
            position: 'fixed',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            color: '#ffffff',
            padding: '12px 24px',
            borderRadius: '24px',
            fontSize: '14px',
            zIndex: '100000',
            boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
            transition: 'opacity 0.2s ease',
            opacity: '0'
        });

        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '1'; }, 10);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 200);
        }, 2000);
    }

    function setupCartIconsObserver() {
        injectCartIcons();

        // 1. DOM 변화 실시간 감시
        const observer = new MutationObserver(() => {
            injectCartIcons();
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // 2. 동적 비동기 로딩(SuperDeals, 무한 스크롤) 백업용 1.5초 주기 폴링
        setInterval(injectCartIcons, 1500);
    }

}
