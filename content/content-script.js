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
        checkAndInitListCollection();
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
     * 목록 담기 기능 초기화 체크
     */
    async function checkAndInitListCollection() {
        const url = window.location.href;
        
        // 상세 페이지인 경우 작동 안 함
        const isDetailPattern = [
            /aliexpress\.com\/item\//,
            /taobao\.com\/item/,
            /1688\.com\/offer\//,
            /tmall\.com\/item/,
            /detail\.tmall\.com/
        ].some(pat => pat.test(url));

        if (isDetailPattern) return;

        // 플랫폼 감지
        if (typeof PlatformDetector === 'undefined') return;
        const platform = PlatformDetector.detect(url);
        if (platform === PlatformDetector.PLATFORMS.GENERIC) return;

        // 백그라운드에 이 플랫폼이 활성화되어 있는지 조회
        try {
            chrome.runtime.sendMessage({
                action: 'checkPlatformActive',
                platformId: platform
            }, (response) => {
                if (response && response.isActive) {
                    console.log(`[ContentScript] ${platform} 플랫폼 활성화 상태 확인. 목록 담기 기능을 시작합니다.`);
                    startListCollectionObserver(platform);
                } else {
                    console.log(`[ContentScript] ${platform} 플랫폼 비활성화 상태. 목록 담기 기능을 시작하지 않습니다.`);
                }
            });
        } catch (e) {
            console.error('[ContentScript] 플랫폼 활성화 체크 실패:', e);
        }
    }

    let currentToast = null;

    /**
     * 담기 결과 토스트 알림 표시
     */
    function showToast(message, isSuccess = true) {
        if (currentToast) currentToast.remove();

        const toast = document.createElement('div');
        toast.className = 'sb-toast';
        toast.innerText = message;
        toast.style.position = 'fixed';
        toast.style.bottom = '24px';
        toast.style.right = '24px';
        toast.style.zIndex = '99999';
        toast.style.padding = '12px 24px';
        toast.style.backgroundColor = isSuccess ? 'rgba(16, 185, 129, 0.95)' : 'rgba(239, 68, 68, 0.95)';
        toast.style.color = '#fff';
        toast.style.borderRadius = '8px';
        toast.style.fontWeight = 'bold';
        toast.style.fontSize = '14px';
        toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
        toast.style.transition = 'all 0.3s ease';
        toast.style.fontFamily = 'system-ui, -apple-system, sans-serif';

        document.body.appendChild(toast);
        currentToast = toast;

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            setTimeout(() => toast.remove(), 300);
        }, 2500);
    }

    /**
     * 상품 리스트에 담기 버튼 관찰 및 추가
     */
    async function startListCollectionObserver(platform) {
        const config = {
            aliexpress: {
                card: '.k7_v, .search-item-card-wrapper-gallery, .list-item, .product-card, [class*="manhattan--container"], .search-card-item',
                link: 'a[href*="/item/"]',
                name: '.k7_kw, h1, h2, h3, [class*="title"], .item-title',
                price: '.k7_lu, [class*="price"], [class*="Price"]',
                image: 'img'
            },
            taobao: {
                card: 'div[class*="item"], li[class*="item"], .item, [class*="Card--"]',
                link: 'a[href*="/item/"], a[href*="detail.tmall.com"]',
                name: '[class*="title"], h1, h2, h3',
                price: '[class*="price"], strong, em',
                image: 'img'
            },
            naver: {
                card: 'li[class*="product_item"], div[class*="product_item"]',
                link: 'a[href*="/products/"]',
                name: '[class*="title"]',
                price: '[class*="price"]',
                image: 'img'
            },
            generic: {
                card: 'div[class*="product"], li[class*="product"]',
                link: 'a',
                name: 'h1, h2, h3, [class*="title"]',
                price: '[class*="price"]',
                image: 'img'
            }
        };

        const platConfig = config[platform] || config.generic;

        // 큐 상태 로드
        let queueResult = await chrome.storage.local.get(['sourcing_collect_queue']);
        let queue = queueResult.sourcing_collect_queue || [];

        const updateButtons = () => {
            const cards = document.querySelectorAll(platConfig.card);
            cards.forEach(card => {
                // 이미 추가된 경우 스킵 및 큐 상태 체크에 따른 싱크
                if (card.querySelector('.sb-list-add-btn')) {
                    const btn = card.querySelector('.sb-list-add-btn');
                    const url = btn.dataset.url;
                    const isAlreadyInQueue = queue.some(item => item.url === url);
                    
                    if (isAlreadyInQueue && btn.innerText !== '✔️ 담김') {
                        btn.innerText = '✔️ 담김';
                        btn.style.backgroundColor = 'rgba(16, 185, 129, 0.95)';
                    } else if (!isAlreadyInQueue && btn.innerText === '✔️ 담김') {
                        btn.innerText = '⭐ 담기';
                        btn.style.backgroundColor = 'rgba(79, 70, 229, 0.9)';
                    }
                    return;
                }

                // 상품 상세 링크 찾기
                const linkEl = card.querySelector(platConfig.link) || card.closest('a');
                if (!linkEl) return;

                let rawUrl = linkEl.href;
                if (!rawUrl || rawUrl.startsWith('javascript:')) return;
                
                if (rawUrl.startsWith('//')) rawUrl = 'https:' + rawUrl;
                let cleanUrl = rawUrl.split('?')[0];

                // 카드 내에 상대 위치 부여
                const currentPos = window.getComputedStyle(card).position;
                if (currentPos !== 'absolute' && currentPos !== 'relative' && currentPos !== 'fixed') {
                    card.style.position = 'relative';
                }

                // 버튼 생성 (인라인 스타일을 사용해 기존 레이아웃/스타일 완벽 유지)
                const addBtn = document.createElement('button');
                addBtn.className = 'sb-list-add-btn';
                addBtn.dataset.url = cleanUrl;

                const isAlreadyInQueue = queue.some(item => item.url === cleanUrl);
                if (isAlreadyInQueue) {
                    addBtn.innerText = '✔️ 담김';
                    addBtn.style.backgroundColor = 'rgba(16, 185, 129, 0.95)';
                } else {
                    addBtn.innerText = '⭐ 담기';
                    addBtn.style.backgroundColor = 'rgba(79, 70, 229, 0.9)';
                }

                addBtn.style.position = 'absolute';
                addBtn.style.top = '8px';
                addBtn.style.right = '8px';
                addBtn.style.zIndex = '999';
                addBtn.style.padding = '6px 12px';
                addBtn.style.color = '#ffffff';
                addBtn.style.border = 'none';
                addBtn.style.borderRadius = '6px';
                addBtn.style.cursor = 'pointer';
                addBtn.style.fontSize = '12px';
                addBtn.style.fontWeight = 'bold';
                addBtn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
                addBtn.style.transition = 'all 0.2s ease';
                addBtn.style.lineHeight = '1';
                addBtn.style.fontFamily = 'system-ui, -apple-system, sans-serif';

                // 호버 효과
                addBtn.addEventListener('mouseenter', () => {
                    addBtn.style.transform = 'scale(1.05)';
                    addBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
                });
                addBtn.addEventListener('mouseleave', () => {
                    addBtn.style.transform = 'scale(1)';
                    addBtn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
                });

                // 클릭 이벤트 바인딩
                addBtn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    const latestResult = await chrome.storage.local.get(['sourcing_collect_queue']);
                    let currentQueue = latestResult.sourcing_collect_queue || [];

                    const isInQueue = currentQueue.some(item => item.url === cleanUrl);

                    if (isInQueue) {
                        currentQueue = currentQueue.filter(item => item.url !== cleanUrl);
                        await chrome.storage.local.set({ sourcing_collect_queue: currentQueue });
                        queue = currentQueue;
                        
                        addBtn.innerText = '⭐ 담기';
                        addBtn.style.backgroundColor = 'rgba(79, 70, 229, 0.9)';
                        showToast('담기 취소되었습니다.', false);
                    } else {
                        const nameEl = card.querySelector(platConfig.name);
                        const name = nameEl ? nameEl.textContent.trim() : '상품명 없음';

                        const priceEl = card.querySelector(platConfig.price);
                        let price = 0;
                        if (priceEl) {
                            price = parseFloat(priceEl.textContent.replace(/[^0-9.]/g, '')) || 0;
                        }

                        const imgEl = card.querySelector(platConfig.image);
                        let imageUrl = '';
                        if (imgEl) {
                            imageUrl = imgEl.src || imgEl.dataset.src || '';
                            if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;
                        }

                        const newItem = {
                            url: cleanUrl,
                            name,
                            price,
                            imageUrl,
                            platform,
                            addedAt: new Date().toISOString()
                        };

                        currentQueue.push(newItem);
                        await chrome.storage.local.set({ sourcing_collect_queue: currentQueue });
                        queue = currentQueue;

                        addBtn.innerText = '✔️ 담김';
                        addBtn.style.backgroundColor = 'rgba(16, 185, 129, 0.95)';
                        showToast('상품을 담았습니다! (몰털이 팝업에서 수집 가능)');
                    }
                });

                card.appendChild(addBtn);
            });
        };

        // 초기 실행
        updateButtons();

        // 1초 주기로 버튼 스캔
        setInterval(updateButtons, 1000);

        // 스토리지 동기화
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'local' && changes.sourcing_collect_queue) {
                queue = changes.sourcing_collect_queue.newValue || [];
                updateButtons();
            }
        });
    }

}
