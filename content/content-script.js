/**
 * Content Script - 메시지 중계 및 초기화
 */



// 1. [Relay] 웹 페이지(Dashboard)에서 오는 메시지를 받아 Background로 전달 (Connection Error 해결책)
if (typeof window.SellerboardContentScriptInitialized === 'undefined') {
    window.SellerboardContentScriptInitialized = true;

    function isContextValid() {
        return typeof chrome !== 'undefined' && chrome.runtime && !!chrome.runtime.id;
    }

    window.addEventListener("message", (event) => {
        // 보안: 신뢰할 수 있는 소스인지 확인 (여기서는 단순히 소스 태그 체크)
        if (event.data?.source === 'SELLERBOARD_WEB' && (event.data?.type === 'SCRAPE_PRODUCT' || event.data?.type === 'SCRAPE_PRODUCT_RELAY')) {
            console.log("[Content] Relaying SCRAPE_PRODUCT to Background:", event.data.payload);

            if (!isContextValid()) {
                console.warn("[Content] Extension context invalidated. Relaying aborted.");
                return;
            }

            // Background로 전달 (내부 메시징이므로 externally_connectable 불필요)
            // 기존 컨벤션(action)과 새 컨벤션(type) 모두 호환되도록 전송
            const payload = event.data.payload || {};
            // 웹에서 온 요청은 기본적으로 'work'로 처리
            if (!payload.collection_type) {
                payload.collection_type = 'work';
            }

            try {
                chrome.runtime.sendMessage({
                    action: 'SCRAPE_PRODUCT',
                    type: 'SCRAPE_PRODUCT',
                    payload: payload
                }, (response) => {
                    console.log("[Content] Background Response:", response);
                    // 필요시 웹 페이지로 다시 응답을 돌려줄 수 있음
                });
            } catch (e) {
                console.error("[Content] sendMessage failed:", e);
            }
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initContentScript);
    } else {
        initContentScript();
    }

    function syncAllCartButtonsUI(cartItems = []) {
        const containedUrls = new Set(cartItems.map(item => 
            (typeof item === 'object' && item !== null) ? item.url : item
        ));

        // 1. 리스트 상품 카드의 담기 아이콘들 전수 동기화
        document.querySelectorAll('.sb-cart-btn').forEach(btn => {
            const itemUrl = btn.dataset.url;
            if (itemUrl) {
                if (containedUrls.has(itemUrl)) {
                    btn.classList.add('sb-contained');
                    btn.title = '이미 담겼습니다';
                } else {
                    btn.classList.remove('sb-contained');
                    btn.title = '담기 수집 목록에 추가';
                }
            }
        });

        // 2. 활성화된 플로팅 분석 정보창 내 담기 버튼 동기화
        if (activeTooltip) {
            const tooltipCartBtn = activeTooltip.querySelector('.sb-tooltip-cart-btn');
            const tooltipItemUrl = activeTooltip.dataset.url;
            if (tooltipCartBtn && tooltipItemUrl) {
                if (containedUrls.has(tooltipItemUrl)) {
                    tooltipCartBtn.classList.add('sb-contained');
                    tooltipCartBtn.innerHTML = `<span>✓</span> <span>담김</span>`;
                } else {
                    tooltipCartBtn.classList.remove('sb-contained');
                    tooltipCartBtn.innerHTML = `<span>🛒</span> <span>담기</span>`;
                }
            }
        }
    }

    function initContentScript() {
        if (isContextValid() && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get({ userMultiplier: 2.5 }, (res) => {
                if (res && res.userMultiplier) {
                    userMultiplier = parseFloat(res.userMultiplier) || 2.5;
                }
            });

            if (chrome.storage.onChanged) {
                chrome.storage.onChanged.addListener((changes, areaName) => {
                    if (areaName === 'local' && changes.cart_items) {
                        const newCartItems = changes.cart_items.newValue || [];
                        syncAllCartButtonsUI(newCartItems);
                    }
                });
            }
        }

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
                                if (isContextValid()) {
                                    chrome.runtime.sendMessage({
                                        action: 'AUTO_SCRAPE_DONE',
                                        data: data
                                    });
                                }
                                return;
                            }

                            console.log("[Content] Verified Description Length:", data.description ? data.description.length : 0);

                            // [ASYNC COMPLETION] 수집 완료 메시지 전송
                            if (isContextValid()) {
                                chrome.runtime.sendMessage({
                                    action: 'AUTO_SCRAPE_DONE',
                                    data: data
                                });
                            }
                        } catch (e) {

                            console.error("Auto Scrape Error:", e);
                            // [ASYNC ERROR] 에러 메시지 전송
                            if (isContextValid()) {
                                chrome.runtime.sendMessage({
                                    action: 'AUTO_SCRAPE_ERROR',
                                    error: e.message
                                });
                            }
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

                if (!isContextValid()) {
                    showErrorModal('수집 오류', '확장 프로그램 컨텍스트가 만료되었습니다. 페이지를 새로고침 해주세요.');
                    sendResponse({ success: false, error: 'Context invalidated' });
                    return;
                }

                // Service Worker로 데이터 전송하여 저장
                let saveResponse;
                try {
                    saveResponse = await chrome.runtime.sendMessage({
                        action: 'saveProduct',
                        data: {
                            ...productData,
                            collection_type: collectionType
                        }
                    });
                } catch (sendErr) {
                    console.error('sendMessage failed:', sendErr);
                    showErrorModal('수집 실패', '백그라운드 통신 오류');
                    sendResponse({ success: false, error: sendErr.message });
                    return;
                }

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
        if (!isContextValid()) return;

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

        // 알리익스프레스(aliexpress.com) 상품 링크 판단 완화 (알뜰마트, 바겐마트, 슈퍼딜, 초이스마트, 1000원샵, GCP 특가 등)
        if (h.includes('aliexpress.com')) {
            return h.includes('/item/') || 
                   h.includes('/product/') || 
                   h.includes('/products/') || 
                   h.includes('/goods/') || 
                   h.includes('detail.html') ||
                   h.includes('bargain') ||
                   h.includes('superdeals') ||
                   h.includes('choice') ||
                   h.includes('gcp/') ||
                   h.includes('productId=') ||
                   h.includes('itemId=') ||
                   h.includes('item_id=') ||
                   h.includes('objectId=') ||
                   h.includes('object_id=') ||
                   h.includes('goodsId=') ||
                   h.includes('goods_id=') ||
                   /\d{10,20}\.html/.test(h) ||
                   /100500\d{8,12}/.test(h) ||
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
        if (!isContextValid()) {
            if (window.sbCartIconsInterval) {
                clearInterval(window.sbCartIconsInterval);
                window.sbCartIconsInterval = null;
            }
            if (window.sbCartIconsObserver) {
                window.sbCartIconsObserver.disconnect();
                window.sbCartIconsObserver = null;
            }
            return;
        }

        // 1. 일반 a[href] 링크 및 알뜰마트/슈퍼딜 data-* 태그 바인딩 요소 수집
        const candidateElements = document.querySelectorAll('a[href], [data-product-id], [data-item-id], [data-object-id], [data-goods-id]');
        candidateElements.forEach(a => {
            let h = a.href || '';
            
            // data-product-id 등 파라미터가 태그에 직접 붙어있는 알뜰마트 템플릿 대응
            if (!h || h === 'javascript:void(0)' || h === '#') {
                const pid = a.dataset.productId || a.dataset.itemId || a.dataset.objectId || a.dataset.goodsId || a.getAttribute('data-product-id') || a.getAttribute('data-item-id');
                if (pid && /^\d{10,20}$/.test(pid)) {
                    h = `https://www.aliexpress.com/item/${pid}.html`;
                }
            }
            
            if (!isProductLink(h)) return;

            // 이미 아이콘이 삽입되어 있다면 패스
            if (a.querySelector('.sb-cart-btn') || a.classList.contains('sb-cart-processed')) return;

            // 이미지 찾기 및 카드 컨테이너 선택자 확장 (알뜰마트, GCP, 바겐마트, 슈퍼딜 특가 카드 지원)
            let img = a.querySelector('img');
            let imgContainer = a;

            const card = a.closest('div[class*="item"], li, div[class*="card"], div[class*="product"], div[class*="subject"], div[class*="goods"], div[class*="bargain"], div[class*="deal"], div[class*="mart"], div[class*="gcp"], div[class*="choice"], div[class*="k7_"], div[class*="cell"], div[class*="offer"], div[class*="box"]');
            if (!img && card) {
                img = card.querySelector('img');
                if (img) {
                    imgContainer = a.offsetHeight > 30 ? a : card;
                }
            }

            // [구제책] 알리 알뜰마트/특가 페이지 등에서 이미지가 가려지거나 z-index로 감싸진 경우에도
            // 카드 또는 태그 크기가 유효하면(가로/세로 40px 이상) 담기 아이콘을 노출합니다.
            const rect = a.getBoundingClientRect();
            const isLargeClickArea = (rect.width > 40 && rect.height > 40) || (card && card.offsetWidth > 40 && card.offsetHeight > 40);
            
            if (!img && !isLargeClickArea) {
                if (card) {
                    const fallbackImg = card.querySelector('img');
                    if (fallbackImg) {
                        img = fallbackImg;
                        imgContainer = card;
                    } else {
                        return; // 텍스트 링크 방지용 최후의 수단
                    }
                } else {
                    return;
                }
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
            btn.dataset.url = h;
            if (!isContextValid()) return;
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
            try {
                chrome.storage.local.get({ cart_items: [] }, (result) => {
                    const isContained = result.cart_items.some(item => 
                        (typeof item === 'object' && item !== null) ? item.url === h : item === h
                    );
                    if (isContained) {
                        btn.classList.add('sb-contained');
                        btn.title = '이미 담겼습니다';
                    }
                });
            } catch (storageErr) {
                console.warn('storage get failed:', storageErr);
            }

            // 클릭 이벤트
            btn.onclick = async (e) => {
                e.preventDefault();
                e.stopPropagation();

                // 해외 쇼핑몰인데 원화(KRW)로 설정되어 있는지 검사
                const platform = PlatformDetector.detect();
                const isKorean = PlatformDetector.isKoreanPlatform(platform);
                
                if (!isKorean) {
                    const priceText = imgContainer.textContent || a.textContent || '';
                    const isWon = priceText.includes('₩') || priceText.toUpperCase().includes('KRW') || /\d[\d,\s]*원/.test(priceText);
                    
                    if (isWon) {
                        showErrorModal('통화 설정 변경 안내', '현재 상품 가격이 원화(KRW)로 설정되어 있습니다.<br><br>해외 소싱 상품은 정확한 수집과 이중 환전 수수료 방지를 위해 쇼핑몰 설정에서 <b>통화를 달러(USD)로 변경</b> 후 다시 시도해 주세요.');
                        return; // 담기 중단
                    }
                }

                if (!isContextValid()) return;

                let result;
                try {
                    result = await chrome.storage.local.get({ cart_items: [] });
                } catch (storageErr) {
                    console.error('storage get failed:', storageErr);
                    return;
                }
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
                    try {
                        await chrome.storage.local.set({ cart_items: newCartItems });
                    } catch (storageErr) {
                        console.error('storage set failed:', storageErr);
                    }
                    btn.classList.remove('sb-contained');
                    btn.title = '담기 수집 목록에 추가';
                    showToast('담기 해제되었습니다.');
                } else {
                    // 추가
                    const imgSrc = img ? (img.src || img.dataset.src || '') : '';
                    cartItems.push({ url: h, imageUrl: imgSrc });
                    try {
                        await chrome.storage.local.set({ cart_items: cartItems });
                    } catch (storageErr) {
                        console.error('storage set failed:', storageErr);
                    }
                    btn.classList.add('sb-contained');
                    btn.title = '이미 담겼습니다';
                    showToast('담기 수집 목록에 추가되었습니다.');
                }
            };

            // 마우스 오버(Hover) 시 플로팅 분석 정보창 표시 로직 추가
            let tooltipTimeout = null;
            btn.addEventListener('mouseenter', (e) => {
                if (tooltipTimeout) clearTimeout(tooltipTimeout);
                tooltipTimeout = setTimeout(() => {
                    showAnalysisTooltip(e, a, card, img, h);
                }, 300); // 300ms 딜레이
            });

            btn.addEventListener('mouseleave', () => {
                if (tooltipTimeout) clearTimeout(tooltipTimeout);
                tooltipTimeout = setTimeout(() => {
                    removeAnalysisTooltip();
                }, 200);
            });

            imgContainer.appendChild(btn);
        });
    }

    let activeTooltip = null;

    function extractCardData(a, card, img, h) {
        let name = '';
        let price = 0;
        let imageUrl = img ? (img.src || img.dataset.src || '') : '';
        let rating = 0;
        let reviewCount = 0;
        let salesVolume = '';

        const platform = PlatformDetector.detect();

        // 부모 카드를 찾았더라도 평점/리뷰 정보가 텍스트에 포함되지 않는 좁은 영역(예: 이미지 전용 컨테이너 등)일 경우
        // 평점/리뷰 텍스트가 발견될 때까지 상위 조상으로 확장하여 탐색합니다.
        let targetCard = card;
        if (targetCard) {
            const txt = targetCard.innerText || '';
            const hasInfo = txt.includes('리뷰') || txt.includes('후기') || txt.includes('★') || txt.includes('⭐') || /\b[3-5]\.[0-9]\b/.test(txt);
            if (!hasInfo) {
                targetCard = null; // 상위 탐색을 유도하기 위해 null 처리
            }
        }

        if (!targetCard) {
            let parent = a.parentElement;
            let depth = 0;
            while (parent && depth < 8 && parent.tagName !== 'BODY') {
                const txt = parent.innerText || '';
                if (txt.includes('리뷰') || txt.includes('후기') || txt.includes('★') || txt.includes('⭐') || /\b[3-5]\.[0-9]\b/.test(txt)) {
                    targetCard = parent;
                    break;
                }
                parent = parent.parentElement;
                depth++;
            }
        }

        if (targetCard) {
            // 1. 이름
            const titleEl = targetCard.querySelector('h1, h2, h3, h4, .title, .name, [class*="title"], [class*="name"]');
            if (titleEl) name = titleEl.textContent.trim();
            if (!name) name = a.textContent.trim();

            // 2. 가격 및 통화(Currency) 정밀 수집 (할인전 원가 및 배송조건 오수집 방지)
            let currency = 'KRW';

            function parsePriceStrictly(text) {
                if (!text) return null;
                const txt = text.trim();

                // "US $7.5 이상", "주문 시", "무료배송" 같은 조건 문구 파싱 기각
                if (txt.includes('이상') || txt.includes('주문') || txt.includes('무료') || txt.includes('쿠폰') || txt.includes('적용')) {
                    return null;
                }

                // 할인율(%) 및 퍼센트 표현 제거 (예: -50%)
                const cleanTxt = txt.replace(/-\d+%/g, '').replace(/\d+%/g, '');
                
                let detectedCurr = 'KRW';
                if (/(?:US\s*\$|USD|\$)/i.test(cleanTxt)) detectedCurr = 'USD';
                else if (/(?:¥|CNY|RMB)/i.test(cleanTxt)) detectedCurr = 'CNY';
                else if (/(?:₩|KRW|원)/i.test(cleanTxt)) detectedCurr = 'KRW';

                // 통화 기호 바로 옆의 독립된 소수점/숫자 패턴만 추출 (예: US $27.15, $27.15, ₩27,150)
                const priceMatch = cleanTxt.match(/(?:US\s*\$|USD|\$|₩|KRW|¥)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i) ||
                                   cleanTxt.match(/([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:원|KRW|won)/i);

                if (priceMatch) {
                    const val = parseFloat(priceMatch[1].replace(/,/g, ''));
                    if (!isNaN(val) && val > 0 && val < 1000000) {
                        return { price: val, currency: detectedCurr };
                    }
                }
                return null;
            }

            // 1차: 알리익스프레스/이커머스 전용 '실제 할인 판매가' 클래스 선택자 우선 탐색
            const priceSelectors = [
                '.k7_lu',
                '[class*="price-kr--current"]',
                '[class*="price--currentPriceText"]',
                '[class*="currentPrice"]',
                '[class*="price--current"]',
                '[class*="price-current"]',
                '[class*="sale-price"]',
                '[class*="price--main"]',
                '[class*="main-price"]'
            ];

            for (const sel of priceSelectors) {
                const els = targetCard.querySelectorAll(sel);
                for (const pEl of els) {
                    // 취소선(del, s) 및 할인전 가격(original/old) 제외
                    if (pEl.tagName === 'DEL' || pEl.tagName === 'S' || pEl.closest('del, s')) continue;
                    if (pEl.className && (pEl.className.includes('original') || pEl.className.includes('del') || pEl.className.includes('old'))) continue;

                    const res = parsePriceStrictly(pEl.textContent);
                    if (res) {
                        price = res.price;
                        currency = res.currency;
                        break;
                    }
                }
                if (price) break;
            }

            // 2차 Fallback: 전용 클래스로 찾지 못한 경우 하위 요소 정밀 매칭 (조건문구 및 취소선 스킵)
            if (!price) {
                const potentialPrices = targetCard.querySelectorAll('[class*="price"], span, strong, em, div');
                for (const p of potentialPrices) {
                    if (p.tagName === 'DEL' || p.tagName === 'S' || p.closest('del, s')) continue;
                    if (p.className && (p.className.includes('original') || p.className.includes('del') || p.className.includes('old') || p.className.includes('shipping') || p.className.includes('title'))) continue;
                    
                    const res = parsePriceStrictly(p.textContent);
                    if (res) {
                        price = res.price;
                        currency = res.currency;
                        break;
                    }
                }
            }

            // 3. 평점 & 리뷰 추출 (하이브리드: 선택자 기반 우선 + 정규식 fallback)
            const cardText = targetCard.innerText;

            // 평점(Rating) 추출
            const ratingEl = targetCard.querySelector('[class*="rating-score"], [class*="rating_score"], [class*="star-score"], [class*="star_score"], [class*="score"], .rating, .star');
            if (ratingEl) {
                const ratMatch = ratingEl.textContent.match(/\b([3-5]\.[0-9])\b/);
                if (ratMatch) rating = parseFloat(ratMatch[1]);
            }
            if (!rating) {
                const ratingMatch = cardText.match(/\b([3-5]\.[0-9])\b/);
                if (ratingMatch) rating = parseFloat(ratingMatch[1]);
            }

            // 리뷰 개수(Review Count) 추출
            // A. 선택자 기반 우선 시도
            const reviewEl = targetCard.querySelector('[class*="review-count"], [class*="review_count"], [class*="review-cnt"], [class*="review_cnt"], [class*="review-num"], [class*="review_num"], .review, .reviewCount, .reviews');
            if (reviewEl) {
                const revText = reviewEl.textContent.trim();
                const numMatch = revText.replace(/,/g, '').match(/\b(\d+)\b/);
                if (numMatch) {
                    reviewCount = parseInt(numMatch[1], 10);
                }
            }

            // B. 텍스트 매칭 기반 fallback (선택자 추출에 실패한 경우)
            if (!reviewCount) {
                const patterns = [
                    // 1) 숫자 + (개/건/개의/건의) + 리뷰/후기/평가/상품평 (국내 쇼핑몰 가장 흔한 패턴)
                    // 예: 64개 리뷰, 64 리뷰, 64개 후기, 64 후기, 64개의 리뷰, 64건의 상품평
                    /\b([0-9,]+)\s*(?:개|건|개의|건의)?\s*(?:리뷰|후기|평가|상품평)\b/i,

                    // 2) 리뷰/후기/평가/상품평/reviews 뒤에 숫자 (괄호 유무 상관 없음)
                    // 예: 리뷰 64, 후기(64), reviews: 64, 평가64개, 상품평 64
                    /(?:리뷰|후기|평가|상품평|reviews?)\s*\(?\s*:?\s*([0-9,]+)/i,

                    // 3) 평점 오른쪽에 위치하는 괄호 형식 (예: 4.8 (64))
                    /\b[3-5]\.[0-9]\s*\(\s*([0-9,]+)\s*\)/,

                    // 4) 별표 기호 옆 평점 옆 숫자 조합 (예: ⭐ 4.8 64, ★ 4.8 | 64, 평점 4.8 / 64)
                    /(?:★|⭐|평점)\s*[3-5]\.[0-9]\s*(?:[\s/|·•\-\(\)]+)\s*([0-9,]+)/,

                    // 5) 단순 평점 옆 숫자 조합 (예: 4.8 64, 4.8/64, 4.8 | 64)
                    /\b[3-5]\.[0-9]\s*(?:[\s/|·•\-\(\)]+)\s*([0-9,]+)\b/,

                    // 6) 영문 reviews 형식 (예: 64 reviews)
                    /\b([0-9,]+)\s*reviews?\b/i,

                    // 7) 일반적인 괄호 형식 (예: (64))
                    /\(\s*([0-9,]+)\s*\)/,

                    // 8) 한국어 단위 명사 형식 (예: 64건, 64개)
                    /\b([0-9,]+)\s*(?:건|개)\b/
                ];

                for (const pattern of patterns) {
                    const match = cardText.match(pattern);
                    if (match) {
                        const matchedText = match[0];
                        const capturedNum = match[1];

                        // 매칭 텍스트 자체에 '리뷰', '후기', '평가', '상품평', 'review' 키워드가 명시적으로 들어있으면
                        // 구매/판매 단어가 옆에 등장하더라도 리뷰 수량이 확실하므로 isSales를 false로 확정합니다.
                        const hasExplicitReviewKeyword = /(?:리뷰|후기|평가|상품평|review)/i.test(matchedText);

                        let isSales = false;
                        if (!hasExplicitReviewKeyword) {
                            // 명시적 리뷰 키워드가 없는 모호한 패턴(예: 4.8 1,000, 1000개 등)인 경우에만 판매 지표 수식어 검사
                            const index = cardText.indexOf(matchedText);
                            const lookahead = cardText.substring(index, index + matchedText.length + 15).toLowerCase();
                            isSales = lookahead.includes('sold') || 
                                      lookahead.includes('구매') || 
                                      lookahead.includes('판매') || 
                                      lookahead.includes('딜') ||
                                      lookahead.includes('order');
                        }

                        // 판매 수량이 아닐 때만 리뷰 개수로 채택
                        if (!isSales) {
                            const numStr = capturedNum.replace(/,/g, '');
                            const num = parseInt(numStr, 10);
                            if (num >= 0 && num < 100000) {
                                reviewCount = num;
                                break; // 올바른 값을 찾았으므로 루프 탈출
                            }
                        }
                    }
                }
            }

            // 3-B. 누적 판매량(Sales Volume) 추출 - 알리 전용 클래스 세렉터 1순위 + 광범위 정규식 2순위
            const salesEl = targetCard.querySelector('.k7_km, [class*="sales--"], [class*="trade"], [class*="sale"], [class*="sold"]');
            if (salesEl && salesEl.textContent.trim()) {
                salesVolume = salesEl.textContent.trim();
            }

            if (!salesVolume) {
                // 패턴: 1,000+ sold, 1,000+개 판매, 1만+개 구매, 10k+ sold, 500+ sold, 92 판매 등
                const salesMatch = cardText.match(/\b([0-9,.]+\s*[kK만+]?|[0-9,.]+\+?)\s*(?:개|건)?\s*(?:판매|구매|sold|bought|orders|누적)/i) ||
                                   cardText.match(/(?:판매|구매|sold|bought|orders|누적)\s*:?\s*([0-9,.]+\s*[kK만+]?)/i);
                if (salesMatch) {
                    salesVolume = salesMatch[0].trim();
                }
            }

            // 4. 배송 & 서비스 태그 (Choice / 무료배송)
            const isChoice = targetCard.querySelector('[class*="choice"], [class*="Choice"]') !== null || cardText.includes('Choice') || cardText.includes('초이스');
            const isFreeShip = cardText.includes('Free shipping') || cardText.includes('무료 배송') || cardText.includes('무료배송');
            let shippingTag = isChoice ? 'Choice 7일배송' : (isFreeShip ? '무료 배송' : '일반 배송');

            return {
                id: h,
                name: name,
                price: price,
                currency: currency,
                imageUrl: imageUrl,
                detailUrl: h,
                platform: platform,
                rating: rating,
                salesVolume: salesVolume,
                reviewCount: reviewCount,
                isChoice: isChoice,
                shippingTag: shippingTag
            };
        } else {
            name = a.textContent.trim();
        }

        if (!name) name = 'No Name';

        return {
            id: h,
            name: name,
            price: price,
            imageUrl: imageUrl,
            detailUrl: h,
            platform: platform,
            rating: rating,
            salesVolume: salesVolume,
            reviewCount: reviewCount,
            isChoice: false,
            shippingTag: '일반 배송'
        };
    }

    let savedUserPos = null;
    let userMultiplier = 2.5;

    function makeTooltipDraggable(tooltip) {
        const header = tooltip.querySelector('.sb-tooltip-header');
        if (!header) return;

        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        header.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;

            e.preventDefault();
            e.stopPropagation();

            isDragging = true;
            const rect = tooltip.getBoundingClientRect();
            startX = e.clientX;
            startY = e.clientY;
            initialLeft = rect.left;
            initialTop = rect.top;

            tooltip.style.transition = 'none';

            const onMouseMove = (moveEvent) => {
                if (!isDragging) return;
                const dx = moveEvent.clientX - startX;
                const dy = moveEvent.clientY - startY;

                let newLeft = initialLeft + dx;
                let newTop = initialTop + dy;

                const maxLeft = window.innerWidth - rect.width - 10;
                const maxTop = window.innerHeight - rect.height - 10;
                newLeft = Math.max(10, Math.min(maxLeft, newLeft));
                newTop = Math.max(10, Math.min(maxTop, newTop));

                tooltip.style.left = `${newLeft}px`;
                tooltip.style.top = `${newTop}px`;

                savedUserPos = { left: `${newLeft}px`, top: `${newTop}px` };
            };

            const onMouseUp = () => {
                isDragging = false;
                tooltip.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    function removeAnalysisTooltip() {
        if (activeTooltip) {
            if (activeTooltip.matches(':hover')) return; // 툴팁 위에 마우스가 있으면 닫기 유예
            activeTooltip.classList.remove('active');
            const tooltipToRemove = activeTooltip;
            setTimeout(() => {
                if (tooltipToRemove && tooltipToRemove.parentNode) {
                    tooltipToRemove.remove();
                }
            }, 200);
            activeTooltip = null;
        }
    }

    function renderAnalysisInTooltip(tooltip, cardData, analyzedItem, currentMult) {
        if (!tooltip || !tooltip.parentNode) return;

        tooltip.dataset.url = cardData.detailUrl || cardData.id || '';

        const mult = currentMult || userMultiplier || 2.5;
        const analysis = (typeof SourcingAnalyzer !== 'undefined') ? SourcingAnalyzer.analyzeItem(cardData, { multiplier: mult }) : (analyzedItem.analysis || {});

        const rating = Math.max(analyzedItem.rating || 0, cardData.rating || 0);
        const salesVolume = cardData.salesVolume || (analyzedItem.salesVolume ? (analyzedItem.salesVolume + '개 판매') : '정보 없음');
        const shippingTag = cardData.shippingTag || '일반 배송';
        const platformName = (analyzedItem.platform || cardData.platform || 'AliExpress').toUpperCase();

        const costPrice = analysis.costPrice || cardData.price || 0;
        const sellingPrice = analysis.sellingPrice || Math.round(costPrice * mult);
        const fee = analysis.fee || Math.round(sellingPrice * 0.0585);
        const shippingCost = analysis.shippingCost || 3000;
        const rawPrice = analysis.rawPrice || cardData.price || 0;
        const currency = analysis.currency || cardData.currency || 'KRW';

        tooltip.innerHTML = `
            <div class="sb-tooltip-header">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span class="sb-tooltip-platform">${platformName}</span>
                        ${cardData.isChoice ? `<span class="sb-tooltip-shipping-tag">CHOICE</span>` : ''}
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <button type="button" class="sb-tooltip-cart-btn" title="소싱 보관함에 담기">
                            <span>🛒</span> <span>담기</span>
                        </button>
                        <div class="sb-drag-handle" title="드래그하여 이동">
                            <span>⋮⋮</span> 드래그 이동
                        </div>
                    </div>
                </div>
                <span class="sb-tooltip-title">${cardData.name}</span>
            </div>
            <div class="sb-tooltip-body">
                <div class="sb-margin-control-bar">
                    <span class="sb-margin-control-title">🎯 마진 설정:</span>
                    <div class="sb-mult-btn-group">
                        <button type="button" class="sb-mult-btn ${mult === 1.5 ? 'active' : ''}" data-mult="1.5">1.5</button>
                        <button type="button" class="sb-mult-btn ${mult === 2.0 ? 'active' : ''}" data-mult="2.0">2.0</button>
                        <button type="button" class="sb-mult-btn ${mult === 2.5 ? 'active' : ''}" data-mult="2.5">2.5</button>
                        <button type="button" class="sb-mult-btn ${mult === 3.0 ? 'active' : ''}" data-mult="3.0">3.0</button>
                        <input type="number" class="sb-custom-mult-input" value="${mult}" step="0.1" min="1.0" max="10.0" title="배율 직접 입력 (예: 2.2배)">
                    </div>
                </div>
                <div class="sb-tooltip-metric-row">
                    <div class="sb-tooltip-metric">
                        <span class="sb-metric-label">소싱 등급</span>
                        <span class="sb-metric-val sb-grade-${analysis.grade}">${analysis.grade || 'C'}</span>
                    </div>
                    <div class="sb-tooltip-metric">
                        <span class="sb-metric-label">종합 점수</span>
                        <span class="sb-metric-val">${analysis.score || 0}점</span>
                    </div>
                </div>
                <div class="sb-tooltip-metric-row">
                    <div class="sb-tooltip-metric">
                        <span class="sb-metric-label">예상 마진율</span>
                        <span class="sb-metric-val">${analysis.marginRate || 0}%</span>
                    </div>
                    <div class="sb-tooltip-metric">
                        <span class="sb-metric-label">예상 순이익</span>
                        <span class="sb-metric-val font-green">+${(analysis.netProfit || 0).toLocaleString()}원</span>
                    </div>
                </div>
                <div class="sb-formula-section">
                    <div class="sb-formula-header">
                        <span>📐 실시간 마진 계산 산식</span>
                        <span>(환율 & 공제 적용)</span>
                    </div>
                    <div class="sb-formula-content">
                        <div class="sb-formula-line">
                            <span>• 소싱 원가:</span>
                            <span>${currency !== 'KRW' ? `${rawPrice} ${currency} × 환율 = ` : ''}${costPrice.toLocaleString()}원</span>
                        </div>
                        <div class="sb-formula-line">
                            <span>• 예상 판매가 (${mult}배 적용):</span>
                            <span>${sellingPrice.toLocaleString()}원</span>
                        </div>
                        <div class="sb-formula-line">
                            <span>• 차감 (수수료+배송비):</span>
                            <span>-${fee.toLocaleString()}원 (5.85%) -${shippingCost.toLocaleString()}원</span>
                        </div>
                        <div class="sb-formula-result-line">
                            <span>• 예상 순이익 (마진율):</span>
                            <span style="color: #34d399;">+${(analysis.netProfit || 0).toLocaleString()}원 (${analysis.marginRate || 0}%)</span>
                        </div>
                    </div>
                </div>
                <div class="sb-ali-metrics-section">
                    <div class="sb-ali-metrics-title">
                        <span>알리 리스트 실시간 수집 지표</span>
                    </div>
                    <div class="sb-ali-metrics-grid">
                        <div class="sb-ali-badge sales">
                            <span class="sb-ali-badge-label">누적 판매량</span>
                            <span class="sb-ali-badge-val">${salesVolume}</span>
                        </div>
                        <div class="sb-ali-badge rating">
                            <span class="sb-ali-badge-label">상품 평점</span>
                            <span class="sb-ali-badge-val">${rating > 0 ? `⭐ ${rating}` : '정보 없음'}</span>
                        </div>
                        <div class="sb-ali-badge shipping">
                            <span class="sb-ali-badge-label">배송 서비스</span>
                            <span class="sb-ali-badge-val">${shippingTag}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
        makeTooltipDraggable(tooltip);

        // 보관함(Cart) 상태 실시간 동기화
        const h = cardData.detailUrl || cardData.id;
        const cartBtn = tooltip.querySelector('.sb-tooltip-cart-btn');
        if (isContextValid() && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get({ cart_items: [] }, (res) => {
                if (!tooltip || !tooltip.parentNode || !cartBtn) return;
                const cartItems = (res && res.cart_items) || [];
                const isContained = cartItems.some(item => 
                    (typeof item === 'object' && item !== null) ? item.url === h : item === h
                );
                if (isContained) {
                    cartBtn.classList.add('sb-contained');
                    cartBtn.innerHTML = `<span>✓</span> <span>담김</span>`;
                } else {
                    cartBtn.classList.remove('sb-contained');
                    cartBtn.innerHTML = `<span>🛒</span> <span>담기</span>`;
                }
            });
        }

        // 담기 버튼 클릭 이벤트
        if (cartBtn) {
            cartBtn.addEventListener('click', async (ev) => {
                ev.preventDefault();
                ev.stopPropagation();

                if (!isContextValid()) return;

                let result;
                try {
                    result = await chrome.storage.local.get({ cart_items: [] });
                } catch (storageErr) {
                    console.error('storage get failed:', storageErr);
                    return;
                }
                const cartItems = result.cart_items || [];
                const isContained = cartItems.some(item => 
                    (typeof item === 'object' && item !== null) ? item.url === h : item === h
                );

                if (isContained) {
                    const newCartItems = cartItems.filter(item => {
                        const itemUrl = (typeof item === 'object' && item !== null) ? item.url : item;
                        return itemUrl !== h;
                    });
                    await chrome.storage.local.set({ cart_items: newCartItems });
                    cartBtn.classList.remove('sb-contained');
                    cartBtn.innerHTML = `<span>🛒</span> <span>담기</span>`;
                    showToast('담기 해제되었습니다.');
                } else {
                    const itemData = {
                        url: h,
                        title: cardData.name || 'No Name',
                        price: cardData.price || 0,
                        image: cardData.imageUrl || '',
                        platform: cardData.platform || 'ali',
                        createdAt: new Date().toISOString()
                    };
                    cartItems.push(itemData);
                    await chrome.storage.local.set({ cart_items: cartItems });
                    cartBtn.classList.add('sb-contained');
                    cartBtn.innerHTML = `<span>✓</span> <span>담김</span>`;
                    showToast('상품이 담기 수집 목록에 추가되었습니다.');
                }
            });
        }

        // 마진 배율 버튼 및 직접 입력 필드 이벤트 바인딩
        const multBtns = tooltip.querySelectorAll('.sb-mult-btn');
        multBtns.forEach(btn => {
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const m = parseFloat(btn.dataset.mult);
                if (m > 0) {
                    userMultiplier = m;
                    if (isContextValid() && chrome.storage && chrome.storage.local) {
                        chrome.storage.local.set({ userMultiplier: m });
                    }
                    renderAnalysisInTooltip(tooltip, cardData, analyzedItem, m);
                }
            });
        });

        const customInput = tooltip.querySelector('.sb-custom-mult-input');
        if (customInput) {
            customInput.addEventListener('change', (ev) => {
                ev.stopPropagation();
                const m = parseFloat(customInput.value);
                if (m >= 1.0 && m <= 10.0) {
                    userMultiplier = m;
                    if (isContextValid() && chrome.storage && chrome.storage.local) {
                        chrome.storage.local.set({ userMultiplier: m });
                    }
                    renderAnalysisInTooltip(tooltip, cardData, analyzedItem, m);
                }
            });
            customInput.addEventListener('click', (ev) => ev.stopPropagation());
        }
    }

    function showAnalysisTooltip(e, a, card, img, h) {
        removeAnalysisTooltip();

        const cardData = extractCardData(a, card, img, h);

        const tooltip = document.createElement('div');
        tooltip.className = 'sb-analysis-tooltip';
        tooltip.innerHTML = `
            <div class="sb-tooltip-header">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                    <span class="sb-tooltip-platform">${cardData.platform || 'Platform'}</span>
                    <div class="sb-drag-handle" title="드래그하여 이동">
                        <span>⋮⋮</span> 드래그 이동
                    </div>
                </div>
                <span class="sb-tooltip-title">${cardData.name}</span>
            </div>
            <div class="sb-tooltip-body" style="text-align: center; padding: 10px 0;">
                <span>분석 중...</span>
            </div>
        `;
        document.body.appendChild(tooltip);
        activeTooltip = tooltip;

        makeTooltipDraggable(tooltip);
        positionTooltip(e, tooltip);

        tooltip.addEventListener('mouseleave', () => {
            setTimeout(() => {
                if (activeTooltip === tooltip) {
                    activeTooltip.classList.remove('active');
                    setTimeout(() => {
                        if (activeTooltip === tooltip && tooltip.parentNode) {
                            tooltip.remove();
                            activeTooltip = null;
                        }
                    }, 200);
                }
            }, 200);
        });

        setTimeout(() => tooltip.classList.add('active'), 50);

        // 1. 컨텐트 스크립트 로컬 분석 즉시 렌더링 (대기 멈춤 현상 차단)
        if (typeof SourcingAnalyzer !== 'undefined') {
            const localAnalysis = SourcingAnalyzer.analyzeItem(cardData, {});
            renderAnalysisInTooltip(tooltip, cardData, { ...cardData, analysis: localAnalysis });
        }

        // 2. 서비스 워커 비동기 백그라운드 메시지 보정
        try {
            if (isContextValid()) {
                chrome.runtime.sendMessage({
                    action: 'ANALYZE_PRODUCTS',
                    items: [cardData],
                    criteria: {}
                }, (response) => {
                    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
                        return; // Extension context invalidated 오류 방지
                    }
                    if (activeTooltip === tooltip && response && response.success && response.items && response.items.length > 0) {
                        renderAnalysisInTooltip(tooltip, cardData, response.items[0]);
                    }
                });
            }
        } catch (msgErr) {
            // Context invalidated 예외 안전 무시
        }
    }

    function positionTooltip(e, tooltip) {
        if (savedUserPos) {
            tooltip.style.left = savedUserPos.left;
            tooltip.style.top = savedUserPos.top;
            return;
        }

        const tooltipWidth = 360;
        let left = window.innerWidth - tooltipWidth - 30;
        let top = 100;

        if (left < 10) {
            left = Math.max(10, e.clientX + 15);
            top = Math.max(10, e.clientY + 15);
        }

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
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
        window.sbCartIconsObserver = observer;

        // 2. 동적 비동기 로딩(SuperDeals, 무한 스크롤) 백업용 1.5초 주기 폴링
        window.sbCartIconsInterval = setInterval(injectCartIcons, 1500);
    }

}
