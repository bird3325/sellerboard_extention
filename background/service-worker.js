/**
 * Service Worker (Simplified for Supabase)
 * 상품 데이터를 Supabase로 전송
 */

// Static import (Service Worker는 dynamic import를 지원하지 않음)
import { SupabaseClient } from '../lib/supabase-client.js';

// Supabase 클라이언트 인스턴스
let supabaseClient = null;

async function initializeSupabase() {
    if (supabaseClient) return supabaseClient;

    try {
        supabaseClient = new SupabaseClient();
        await supabaseClient.initialize();

        return supabaseClient;
    } catch (error) {
        console.error('[ServiceWorker] Supabase 초기화 실패:', error);
        return null;
    }
}

// 초기화
chrome.runtime.onInstalled.addListener(() => {

    initializeSupabase();
});

// 시작 시(브라우저 시작 시) 체크
chrome.runtime.onStartup.addListener(async () => {

    const result = await chrome.storage.local.get(['keepLogin']);
    if (!result.keepLogin) {
        const client = await initializeSupabase();
        if (client) {
            await client.signOut();

        }
    }
});

// 초기화
initializeSupabase();

// 버전 확인용 로그
console.log('[ServiceWorker] SellerBoard v2.1.1 Loaded (Active Check Enhanced)');

/**
 * 메시지 리스너
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {


    switch (message.action) {
        case 'saveProduct':
            handleSaveProduct(message.data, sendResponse);
            return true; // 비동기 응답

        case 'getStats':
            handleGetStats(sendResponse);
            return true;

        case 'signIn':
            handleSignIn(message.email, message.password, sendResponse);
            return true;

        case 'signOut':
            handleSignOut(sendResponse);
            return true;

        case 'getSession':
            handleGetSession(sendResponse);
            return true;

        case 'checkDuplicate':
            handleCheckDuplicate(message.url, sendResponse);
            return true;

        case 'batchCollect':
            handleBatchCollect(message, sendResponse);
            return true;

        case 'checkPlatformActive':
            handleCheckPlatformActive(message.platformId, sendResponse);
            return true;

        case 'EXECUTE_SOURCING':
            performSourcing(message.data)
                .then(results => sendResponse(results))
                .catch(err => {
                    console.error('[ServiceWorker] 소싱 오류:', err);
                    sendResponse({ error: err.message });
                });
            return true;

        case 'SCRAPE_PRODUCT':
            const url = message.payload ? message.payload.url : (message.url || message.data?.url);
            handleScraping(url, sendResponse);
            return true;
    }
});

/**
 * 외부 메시지 리스너 (웹 -> 확장프로그램)
 */
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
    console.log('[ServiceWorker] Received message from Web:', request);
    if (request.type === 'SCRAPE_PRODUCT' || request.action === 'SCRAPE_PRODUCT') {
        const url = request.payload ? request.payload.url : request.url;
        handleScraping(url, sendResponse);
        return true; // 비동기 응답을 위해 true 반환
    }

    if (request.type === 'PING') {
        sendResponse({ type: 'PONG' });
    }
});

/**
 * 스크래핑 핸들러
 */
async function handleScraping(url, sendResponse) {
    try {
        if (!url) {
            sendResponse({ type: 'SOURCING_ERROR', error: 'No URL provided' });
            return;
        }

        // 이미 해당 URL이 열려있는지 확인하거나, 현재 활성 탭을 사용
        let targetTab = null;

        // 전략: 웹에서 이미 window.open으로 페이지를 열었다면, 그 탭을 찾아서 활용
        // 정확한 매칭을 위해 쿼리 스트링 등 고려 (url + "*")
        const tabs = await chrome.tabs.query({ url: url + "*" });

        if (tabs && tabs.length > 0) {
            targetTab = tabs[0];
            console.log('[ServiceWorker] 기존 탭 발견:', targetTab.id);
            // 탭이 로딩 완료될 때까지 대기하지 않고 바로 시도
        } else {
            console.log('[ServiceWorker] 새 탭 생성:', url);
            // 탭이 없으면 새로 생성 (백그라운드에서 실행 시)
            targetTab = await chrome.tabs.create({ url: url, active: false });
            // 로딩 대기
            await new Promise(resolve => {
                const listener = (tabId, info) => {
                    if (tabId === targetTab.id && info.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(listener);
                        resolve();
                    }
                };
                chrome.tabs.onUpdated.addListener(listener);
            });
        }

        // 3. Command Content Script로 수집 명령 전송
        // 직접 sendMessage 대신 sendMessageToTabWithRetry 사용하여 연결 안정성 확보
        const response = await sendMessageToTabWithRetry(targetTab.id, { action: "EXT_SCRAPE_NOW" });

        console.log("[ServiceWorker] Scraped Data:", response);

        // [AUTO SAVE] 상품 수집 시 즉시 DB 저장 (User Request)
        // Manual collection Logic과 동일하게 처리 (User Request: "참조해서 수정")
        let saveResult = { saved: false, error: null };

        if (response && !response.error) {
            try {
                if (response.skipped) {
                    console.log('[ServiceWorker] 상품 수집이 제외되었습니다:', response.reason);
                    saveResult.skipped = true;
                    saveResult.error = response.reason;
                    // 알림 (선택적)
                    /*
                    chrome.notifications.create({
                        type: 'basic',
                        iconUrl: chrome.runtime.getURL('assets/icons/icon48.png'),
                        title: '수집 제외',
                        message: response.reason || '수집이 제외된 상품입니다.',
                        silent: true
                    });
                    */
                } else {
                    // Ensure default collection_type if not present
                    if (!response.collection_type) response.collection_type = '워크플로우 수집상품';

                    // handleSaveProduct 로직을 참조하여 간소화
                    // (세션 체크는 saveProduct 내부에서 validateSession 호출로 처리됨)
                    const client = await initializeSupabase();
                    const savedData = await client.saveProduct(response);

                    console.log("[ServiceWorker] Auto saved product to DB:", response.name);

                    // 성공 처리
                    saveResult.saved = true;
                    if (savedData && savedData.product_id) {
                        saveResult.productId = savedData.product_id;
                    }

                    // 성공 알림 (handleSaveProduct와 동일)
                    chrome.notifications.create({
                        type: 'basic',
                        iconUrl: chrome.runtime.getURL('assets/icons/icon48.png'),
                        title: '상품 자동 수집 완료',
                        message: `${response.name}이(가) 저장되었습니다.`,
                        silent: true
                    });

                }
            } catch (saveErr) {
                console.error("[ServiceWorker] Failed to auto-save to DB:", saveErr);
                saveResult.error = saveErr.message || saveErr.toString();

                // 실패 알림
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: chrome.runtime.getURL('assets/icons/icon48.png'),
                    title: '자동 저장 실패',
                    message: `저장 중 오류가 발생했습니다: ${saveResult.error}`,
                    silent: true
                });
            }

            // [Auto Close] 수집 완료 후 탭 닫기
            try {
                if (targetTab && targetTab.id) {
                    await chrome.tabs.remove(targetTab.id);
                    console.log('[ServiceWorker] 수집 완료 후 탭 닫기 성공:', targetTab.id);
                }
            } catch (closeErr) {
                console.warn('[ServiceWorker] 탭 닫기 실패 (이미 닫혔거나 오류):', closeErr);
            }
        }

        // 결과에 저장 상태 포함
        const finalPayload = {
            ...response,
            autoSave: saveResult
        };

        sendResponse({ type: 'SOURCING_COMPLETE', payload: finalPayload });

    } catch (e) {
        console.error("[ServiceWorker] Scraping failed:", e);
        sendResponse({ type: 'SOURCING_ERROR', error: e.toString() });
    }
}

/**
 * 소싱 요청 처리 (Web App -> Extension)
 */
async function performSourcing({ keyword, platform, sourcing_workflows }) {
    console.log(`[ServiceWorker] 소싱 시작: 키워드="${keyword}", 플랫폼="${platform}"`);
    let tabId = null;

    try {
        // 1. 설정 추출 (sourcing_workflows에서 id: "3" 모듈 찾기)
        let limit = 50; // 기본값
        let sortType = ''; // 정렬 기준

        if (sourcing_workflows && sourcing_workflows.modules) {
            const module = sourcing_workflows.modules.find(m => m.id === "3");
            if (module) {
                // Config 구조 지원 (module.config.limit 또는 module.limit)
                const config = module.config || module;
                if (config.limit) limit = parseInt(config.limit, 10);
                if (config.sortBy) sortType = config.sortBy;
                else if (config.sort) sortType = config.sort;

                console.log(`[ServiceWorker] 워크플로우 설정 적용: Limit=${limit}, Sort=${sortType}`);
            }
        }

        // 2. 검색 URL 생성 (정렬 파라미터 적용)
        let searchUrl = '';
        const encodedKeyword = encodeURIComponent(keyword);

        if (platform === '1688') {
            searchUrl = `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodedKeyword}`;
            // 1688 정렬 매핑
            if (sortType === 'price_asc') searchUrl += '&sortType=price';
            else if (sortType === 'sales_desc') searchUrl += '&sortType=booked';
        }
        else if (platform === 'taobao') {
            searchUrl = `https://s.taobao.com/search?q=${encodedKeyword}`;
            // 타오바오 정렬 매핑
            if (sortType === 'price_asc') searchUrl += '&sort=price-asc';
            else if (sortType === 'sales_desc') searchUrl += '&sort=sale-desc';
            else if (sortType === 'credit_desc') searchUrl += '&sort=credit-desc';
        }
        else if (platform === 'coupang') {
            searchUrl = `https://www.coupang.com/np/search?q=${encodedKeyword}`;
            // 쿠팡 정렬 매핑
            if (sortType === 'price_asc') searchUrl += '&sorter=salePriceAsc'; // 낮은가격순
            else if (sortType === 'sales_desc') searchUrl += '&sorter=saleVolume'; // 판매량순
            else if (sortType === 'latest_desc') searchUrl += '&sorter=latestAsc'; // 최신순 (오름차순이 최신?) -> 보통 latestDesc 확인 필요, 쿠팡은 sorter 사용
        }
        else if (platform === 'aliexpress') {
            searchUrl = `https://www.aliexpress.com/wholesale?SearchText=${encodedKeyword}`;
            // 알리 정렬 매핑
            if (sortType === 'price_asc') searchUrl += '&SortType=price_asc';
            else if (sortType === 'sales_desc') searchUrl += '&SortType=orders_desc';
            else if (sortType === 'rating_desc') searchUrl += '&SortType=seller_rating_desc'; // 존재하는지 확인 필요, 보통 orders나 default
            else searchUrl += '&SortType=default';
        }
        else {
            throw new Error(`지원하지 않는 플랫폼입니다: ${platform}`);
        }

        // 3. 새 탭 열기 (활성화 상태로)
        const tab = await chrome.tabs.create({ url: searchUrl, active: true });
        tabId = tab.id;

        // 4. 페이지 로딩 대기
        await waitForTabLoad(tabId);
        await delay(2000); // 추가 안정화

        // 5. 스크립트 주입 및 데이터 수집 요청
        // limit을 함께 전송하여 파서에서 최적화 할 수 있도록 함 (선택적)
        const response = await sendMessageToTabWithRetry(tabId, {
            action: 'collectSearchResults',
            filters: { limit }
        });

        if (!response || !response.success) {
            throw new Error(response?.error || '데이터 수집 실패');
        }

        // 6. 수집된 아이템 매핑 및 제한 적용
        let items = response.items || [];
        console.log(`[ServiceWorker] 탭에서 수집된 원본 아이템 수: ${items.length}`);

        if (items.length === 0) {
            console.warn('[ServiceWorker] 수집된 아이템이 없습니다.');
        }

        // Limit 적용 (앞에서부터 자름)
        if (items.length > limit) {
            items = items.slice(0, limit);
        }

        const limitedItems = items.map((item, index) => ({
            id: item.id || `temp_${Date.now()}_${index}`,
            name: item.name || 'No Name',
            price: typeof item.price === 'string' ? parseFloat(item.price.replace(/[^0-9.]/g, '')) : item.price,
            detailUrl: item.detailUrl || item.url || '',
            imageUrl: item.imageUrl || '',
            platform: platform,
            rating: item.rating || 0,
            salesVolume: item.salesText || item.salesVolume || '',
            reviewCount: item.reviewCount || 0
        }));

        console.log(`[ServiceWorker] 최종 저장할 아이템 수: ${limitedItems.length}`);

        // 로컬 스토리지에 결과 저장
        try {
            await chrome.storage.local.set({ 'sourcing_results': limitedItems });

            // 저장 확인
            const check = await chrome.storage.local.get('sourcing_results');
            console.log('[ServiceWorker] 저장 확인 (sourcing_results):', check.sourcing_results ? check.sourcing_results.length : 0);

            console.log('[ServiceWorker] 소싱 결과 로컬스토리지 저장 완료');
        } catch (storageError) {
            console.error('[ServiceWorker] 로컬스토리지 저장 실패:', storageError);
        }

        // 7. 탭 닫기
        await chrome.tabs.remove(tabId);

        return limitedItems;

    } catch (error) {
        console.error('[ServiceWorker] performSourcing 에러:', error);
        if (tabId) try { await chrome.tabs.remove(tabId); } catch (e) { } // 에러 시에도 탭 정리
        throw error;
    }
}

/**
 * 상품 저장 처리 (Supabase)
 */
async function handleSaveProduct(productData, sendResponse) {
    try {
        const client = await initializeSupabase();

        // Supabase에 저장 (내부에서 플랫폼 활성 상태 최종 검증 수행)
        await client.saveProduct(productData);

        // 알림
        chrome.notifications.create({
            type: 'basic',
            iconUrl: chrome.runtime.getURL('assets/icons/icon48.png'),
            title: '상품 수집 완료',
            message: `${productData.name}이(가) Supabase에 저장되었습니다.`,
            silent: true
        });

        sendResponse({ success: true });
    } catch (error) {
        console.error('[ServiceWorker] 상품 저장 오류:', error);
        sendResponse({ success: false, error: error.message });
    }
}

/**
 * 통계 조회
 */
async function handleGetStats(sendResponse) {
    try {
        const client = await initializeSupabase();
        const stats = await client.getStats();
        sendResponse(stats);
    } catch (error) {
        console.error('[ServiceWorker] 통계 조회 오류:', error);
        sendResponse({ total: 0, today: 0 });
    }
}

/**
 * 로그인 처리
 */
async function handleSignIn(email, password, sendResponse) {
    try {
        const client = await initializeSupabase();
        const result = await client.signIn(email, password);
        sendResponse(result);
    } catch (error) {
        console.error('[ServiceWorker] 로그인 오류:', error);
        sendResponse({ success: false, error: error.message });
    }
}

/**
 * 로그아웃 처리
 */
async function handleSignOut(sendResponse) {
    try {
        const client = await initializeSupabase();
        const result = await client.signOut();
        sendResponse(result);
    } catch (error) {
        console.error('[ServiceWorker] 로그아웃 오류:', error);
        sendResponse({ success: false, error: error.message });
    }
}

/**
 * 세션 조회
 */
async function handleGetSession(sendResponse) {
    try {
        const client = await initializeSupabase();

        // 세션이 있으면 유효성 검사 수행
        if (client.getSession()) {
            const isValid = await client.validateSession();
            if (!isValid) {
                sendResponse({ session: null });
                return;
            }
        }

        const session = client.getSession();
        sendResponse({ session });
    } catch (error) {
        console.error('[ServiceWorker] 세션 조회 오류:', error);
        sendResponse({ session: null });
    }
}

/**
 * 중복 상품 체크
 */
async function handleCheckDuplicate(url, sendResponse) {
    try {
        const client = await initializeSupabase();
        const result = await client.checkDuplicateByUrl(url);
        sendResponse(result);
    } catch (error) {
        console.error('[ServiceWorker] 중복 체크 오류:', error);
        sendResponse({ isDuplicate: false, product: null });
    }
}

/**
 * 배치 수집 처리
 */
async function handleBatchCollect(message, sendResponse) {
    const progressWindowId = message.progressWindowId;

    try {


        // Progress 창이 완전히 로드될 때까지 대기

        await delay(1500);


        /* 0. 전송 한도 체크 제거
        const client = await initializeSupabase();
        const session = client.getSession();
        if (!session || !session.profile || session.profile.transmission_limit <= 0) {
            const msg = '전송 한도가 초과되었습니다. 수집을 진행할 수 없습니다.';
 
            // Progress 창에 에러 표시 (메시지 전송)
            // TODO: Progress 창에서 이 메시지를 처리할 수 있어야 함. 
            // 현재는 간단히 알림만 띄우고 종료
 
            chrome.notifications.create({
                type: 'basic',
                iconUrl: chrome.runtime.getURL('assets/icons/icon48.png'),
                title: '수집 실패',
                message: msg
            });
 
            sendResponse({ success: false, error: msg });
            return;
        }
        */

        // 1. 모든 탭 조회 (모든 창)
        const allTabs = await chrome.tabs.query({});

        // 2. 확장 프로그램 페이지 제외
        const tabs = allTabs.filter(tab => {
            if (!tab.url || tab.url.startsWith('chrome-extension://') ||
                tab.url.startsWith('chrome://') || tab.url.startsWith('about:')) {

                return false;
            }
            console.log(`[ServiceWorker] 포함: ${tab.url}`);
            return true;
        });



        // 3. 상품 페이지 탭만 필터링 + 플랫폼 활성 상태 체크
        const productTabs = [];
        const client = await initializeSupabase();

        for (const tab of tabs) {
            const isProduct = isProductPage(tab.url);
            if (isProduct) {
                const platformId = detectPlatform(tab.url);
                const platformStatus = await client.checkPlatformActive(platformId);

                if (platformStatus.isActive) {
                    productTabs.push(tab);
                } else {
                    console.warn(`[ServiceWorker] 플랫폼 ${platformId} 비활성으로 배치 수집 대상에서 제외: ${tab.url}`);
                }
            }
        }



        if (productTabs.length === 0) {
            sendResponse({
                success: false,
                error: '수집 가능한 상품 페이지가 없거나 모든 관련 플랫폼이 비활성 상태입니다.'
            });
            return;
        }

        // 3. 결과 객체 초기화
        const results = {
            total: productTabs.length,
            success: 0,
            failed: 0,
            skipped: 0,
            errors: []
        };

        // 5. 순차 수집
        for (let i = 0; i < productTabs.length; i++) {
            const tab = productTabs[i];
            const current = i + 1;
            // 완료된 탭 수로 percentage 계산 (시작 시 0%)
            const completed = i;
            const percentage = Math.floor((completed / productTabs.length) * 100);

            try {




                // 진행 상황 전송 (시작 시)
                chrome.runtime.sendMessage({
                    action: 'batchProgress',
                    data: {
                        current: completed,
                        total: productTabs.length,
                        percentage,
                        currentTab: tab.title || tab.url || 'Loading...'
                    }
                }).catch(() => { }); // 팝업이 닫혀있을 수 있음

                // 탭 활성화 및 로딩 대기
                await chrome.tabs.update(tab.id, { active: true });


                // 탭이 완전히 로드될 때까지 대기 (최대 10초)
                await waitForTabLoad(tab.id);


                await delay(2000); // 페이지 안정화 대기

                // 수집 메시지 전송 (재시도 로직 포함)

                const collectResponse = await sendMessageToTabWithRetry(tab.id, {
                    action: 'trigger_product',
                    collection_type: 'batch'
                });


                if (collectResponse && collectResponse.success) {

                    results.success++;
                } else {
                    throw new Error(collectResponse?.error || '수집 실패');
                }

                // 다음 탭으로 이동하기 전 대기 (저장 완료 보장)

                await delay(3000);

            } catch (error) {
                console.error(`[ServiceWorker] 탭 "${tab.title}" 수집 실패:`, error);
                results.failed++;
                results.errors.push({
                    tab: tab.title || tab.url,
                    error: error.message
                });
            }
        }



        // 완료 메시지 전송
        chrome.runtime.sendMessage({
            action: 'batchComplete',
            results: results
        }).catch(() => { });

        sendResponse({ success: true, results });

    } catch (error) {
        console.error('[ServiceWorker] 배치 수집 오류:', error);
        sendResponse({ success: false, error: error.message });
    }
}

/**
 * 상품 페이지 판별
 */
function isProductPage(url) {
    if (!url) return false;

    const patterns = [
        /aliexpress\.com\/item\//,
        /taobao\.com\/item/,
        /1688\.com\/offer\//,
        /tmall\.com\/item/,
        /detail\.tmall\.com/
    ];

    return patterns.some(pattern => pattern.test(url));
}

/**
 * 딜레이 함수
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 탭 로딩 대기
 */
function waitForTabLoad(tabId, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            resolve(); // 타임아웃 되어도 진행 (이미 로드되었을 수 있음)
        }, timeout);

        chrome.tabs.get(tabId, (tab) => {
            if (tab.status === 'complete') {
                clearTimeout(timer);
                resolve();
            } else {
                // 리스너로 완료 대기
                const listener = (tid, changeInfo) => {
                    if (tid === tabId && changeInfo.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(listener);
                        clearTimeout(timer);
                        resolve();
                    }
                };
                chrome.tabs.onUpdated.addListener(listener);
            }
        });
    });
}

/**
 * 메시지 전송 (재시도 및 스크립트 주입 포함)
 */
async function sendMessageToTabWithRetry(tabId, message, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            // 탭 존재 여부 확인 (불필요한 에러 방지)
            const tab = await chrome.tabs.get(tabId).catch(() => null);
            if (!tab) throw new Error(`No tab with id: ${tabId}`);

            // 1. 메시지 전송 시도
            return await chrome.tabs.sendMessage(tabId, message);
        } catch (error) {
            // 2. 연결 실패 시 스크립트 주입 시도 (첫 번째 실패 시에만)
            // 탭이 닫힌 경우(No tab with id)는 주입 시도하지 않음
            if (i === 0 && error.message.includes('Could not establish connection')) {

                try {
                    // 탭이 여전히 존재하는지 재확인
                    const currentTab = await chrome.tabs.get(tabId).catch(() => null);
                    if (!currentTab) throw new Error(`Tab ${tabId} closed before injection`);

                    // manifest.json의 content_scripts와 동일한 순서로 모든 파일 주입
                    await chrome.scripting.executeScript({
                        target: { tabId: tabId },
                        files: [
                            'lib/platform-detector.js',
                            'parsers/base-parser.js',
                            'parsers/chinese-platforms/aliexpress-parser.js',
                            'parsers/chinese-platforms/1688-parser.js',
                            'parsers/chinese-platforms/taobao-parser.js',
                            'parsers/korean-platforms/naver-parser.js',
                            'parsers/korean-platforms/coupang-parser.js',
                            'parsers/korean-platforms/gmarket-parser.js',
                            'parsers/korean-platforms/auction-parser.js',
                            'parsers/korean-platforms/11st-parser.js',
                            'parsers/parser-manager.js',
                            'content/content-script.js'
                        ]
                    });

                    await delay(1000); // 스크립트 초기화 대기
                    continue; // 재시도
                } catch (scriptError) {
                    console.error('[ServiceWorker] 스크립트 주입 실패:', scriptError);
                    // 탭이 없으면 즉시 중단
                    if (scriptError.message.includes('No tab')) throw scriptError;
                }
            }

            // 3. 마지막 시도면 에러 throw
            if (i === retries - 1) throw error;

            // 4. 대기 후 재시도
            await delay(1000);
        }
    }
}


/**
 * 플랫폼 활성 상태 체크 처리
 */
async function handleCheckPlatformActive(platformId, sendResponse) {
    try {
        const client = await initializeSupabase();
        const result = await client.checkPlatformActive(platformId);
        sendResponse(result);
    } catch (error) {
        console.error('[ServiceWorker] 플랫폼 활성 체크 오류:', error);
        sendResponse({ isActive: false, isListed: false });
    }
}

/**
 * URL 기반 플랫폼 감지 (간이 버전 - PlatformDetector와 동기화)
 */
function detectPlatform(url) {
    if (!url) return 'generic';
    const lowUrl = url.toLowerCase();

    if (lowUrl.includes('aliexpress.com')) return 'aliexpress';
    if (lowUrl.includes('taobao.com') || lowUrl.includes('tmall.com')) return 'taobao';
    if (lowUrl.includes('1688.com')) return '1688';

    // 한국 플랫폼
    if (lowUrl.includes('smartstore.naver.com') || lowUrl.includes('shopping.naver.com')) return 'naver';
    if (lowUrl.includes('coupang.com')) return 'coupang';
    if (lowUrl.includes('gmarket.co.kr')) return 'gmarket';
    if (lowUrl.includes('auction.co.kr')) return 'auction';
    if (lowUrl.includes('11st.co.kr')) return '11st';

    return 'generic';
}
