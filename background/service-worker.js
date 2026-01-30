/**
 * Service Worker (Simplified for Supabase)
 * 상품 데이터를 Supabase로 전송
 */

// Static import (Service Worker는 dynamic import를 지원하지 않음)
import { SupabaseClient } from '../lib/supabase-client.js';
import { UrlUtils } from '../lib/url-utils.js';

// Supabase 클라이언트 인스턴스
let supabaseClient = null;

// [ASYNC SCRAPING] 진행 중인 스크래핑 요청을 추적하기 위한 Map
// Key: tabId, Value: { resolve, reject, timer }
const pendingScrapes = new Map();

// 중복 요청 방지를 위한 Set (최근 처리 중인 URL 저장)
const processingUrls = new Set();

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
console.log('[ServiceWorker] SellerBoard v2.1.2 Loaded (Timeout Extended)');

/**
 * 탭 닫힘 감지 (진행 중인 스크래핑 정리)
 */
chrome.tabs.onRemoved.addListener((tabId) => {
    if (pendingScrapes.has(tabId)) {
        const { reject, timer } = pendingScrapes.get(tabId);
        clearTimeout(timer);
        pendingScrapes.delete(tabId);
        reject(new Error('사용자가 탭을 닫아서 수집을 중단했습니다.'));
    }
});

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
            console.log('[ServiceWorker] Internal SCRAPE_PRODUCT received:', message);
            const url = message.payload ? message.payload.url : (message.url || message.data?.url);

            // 기본값 설정 (Web App에서 온 요청은 'work'로 강제)
            let defaultCollectionType = 'single';
            if (sender.tab && sender.tab.url) {
                const origin = new URL(sender.tab.url).origin;
                if (origin.includes('localhost:3000') || origin.includes('sellerboard.vercel.app')) {
                    defaultCollectionType = 'work';
                    console.log('[ServiceWorker] Request from Web App detected. Defaulting to WORK mode.');
                }
            }

            const collectionType = message.payload?.collection_type || message.collection_type || defaultCollectionType;
            console.log('[ServiceWorker] Determined Collection Type:', collectionType);
            handleScraping(url, sendResponse, collectionType);
            return true;

        case 'SYNC_SESSION':
            handleSyncSession(message.sessionData, sendResponse);
            return true;

        // [ASYNC SCRAPING] 수집 완료 메시지 처리
        case 'AUTO_SCRAPE_DONE':
            handleAutoScrapeDone(message, sender, sendResponse);
            return true;

        // [ASYNC SCRAPING] 수집 에러 메시지 처리
        case 'AUTO_SCRAPE_ERROR':
            handleAutoScrapeError(message, sender, sendResponse);
            return true;
    }
});

/**
 * 외부 세션 동기화 핸들러
 */
async function handleSyncSession(sessionData, sendResponse) {
    try {
        const client = await initializeSupabase();
        const result = await client.setSession(sessionData);
        sendResponse(result);
    } catch (error) {
        console.error('[ServiceWorker] Session sync failed:', error);
        sendResponse({ success: false, error: error.message });
    }
}

/**
 * 외부 메시지 리스너 (웹 -> 확장프로그램)
 */
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
    console.log('[ServiceWorker] Received message from Web:', request);
    if (request.type === 'SCRAPE_PRODUCT' || request.action === 'SCRAPE_PRODUCT') {
        const url = request.payload ? request.payload.url : request.url;
        const collectionType = request.payload?.collection_type || request.collection_type || 'work'; // Default to work (Workflow)
        handleScraping(url, sendResponse, collectionType);
        return true; // 비동기 응답을 위해 true 반환
    }

    if (request.type === 'PING') {
        sendResponse({ type: 'PONG' });
    }
});

/**
 * 중복 탭 생성을 방지하며 탭을 엽니다.
 */
// [ASYNC SCRAPING] 진행 중인 스크래핑 요청 (Promise Coalescing)
// Key: Normalized URL, Value: Promise<Result>
const scrapeRequestMap = new Map();

/**
 * 중복 탭 생성을 방지하며 탭을 엽니다.
 */
async function openDedicatedScrapeTab(url) {
    // 1. URL 정규화 (트래킹 파라미터 제거)
    const normalizedUrl = UrlUtils.normalize(url);
    const baseUrl = UrlUtils.getBaseUrl(url);

    // 2. 이미 열린 탭 검색 (정확도 향상을 위해 Base URL + Query Pattern 검색은 복잡하므로 Base URL로 1차 필터링)
    // 주의: 단순 Base URL 검색은 다른 상품(파라미터 차이)을 같은 탭으로 오인할 수 있음.
    // 하지만 브라우저 tabs.query는 패턴 매칭 제한이 있음.
    // 따라서 모든 탭을 가져와서 비교하거나, Base URL로 검색 후 필터링해야 함.

    // 여기서는 기존 로직대로 BaseURL + wildcard 사용하되, 검색된 탭들의 URL을 2차 검증
    const tabs = await chrome.tabs.query({ url: baseUrl + '*' });

    // 정확한 매칭 탭 찾기 (Normalized URL 기준 비교)
    const existingTab = tabs.find(tab => {
        return UrlUtils.normalize(tab.url) === normalizedUrl;
    });

    if (existingTab) {
        // 이미 존재하는 탭 사용
        console.log(`[ServiceWorker] Existing tab found for ${normalizedUrl}. Focusing tab ${existingTab.id}`);
        await safeTabOperation(() => chrome.tabs.update(existingTab.id, { active: true }));

        try {
            await chrome.windows.update(existingTab.windowId, { focused: true });
        } catch (e) { }

        return { tab: existingTab, isNew: false };
    }

    // 3. 새 탭 생성
    console.log('[ServiceWorker] Creating new tab for:', url);
    const tab = await safeTabOperation(() => chrome.tabs.create({ url: url, active: true }));
    return { tab: tab, isNew: true };
}

/**
 * 스크래핑 핸들러 (Promise Coalescing Applied)
 */
async function handleScraping(url, sendResponse, collectionType = 'single') {
    console.log(`[ServiceWorker] handleScraping START | URL: ${url} | Type: ${collectionType}`);

    if (!url) {
        sendResponse({ type: 'SOURCING_ERROR', error: 'No URL provided' });
        return;
    }

    // URL Scheme 보정
    if (url.startsWith('//')) {
        url = 'https:' + url;
    } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }

    const normalizedUrl = UrlUtils.normalize(url);

    // [Request Coalescing] 이미 진행 중인 동일 상품 수집 요청이 있다면, 그 결과를 공유
    if (scrapeRequestMap.has(normalizedUrl)) {
        console.log(`[ServiceWorker] Joining existing scrape request for: ${normalizedUrl}`);
        try {
            const result = await scrapeRequestMap.get(normalizedUrl);
            sendResponse(result); // 기존 요청의 결과를 동일하게 반환
        } catch (error) {
            sendResponse({ type: 'SOURCING_ERROR', error: error.message || 'Scraping failed' });
        }
        return;
    }

    // 새 요청 시작
    const scrapePromise = performScrapingInternal(url, normalizedUrl, collectionType);

    // Map에 등록
    scrapeRequestMap.set(normalizedUrl, scrapePromise);

    try {
        const result = await scrapePromise;
        sendResponse(result);
    } catch (error) {
        console.error(`[ServiceWorker] Scraping failed for ${normalizedUrl}:`, error);
        sendResponse({ type: 'SOURCING_ERROR', error: error.message || 'Scraping failed during execution' });
    } finally {
        // 완료 후 Map에서 제거
        scrapeRequestMap.delete(normalizedUrl);
    }
}

/**
 * 실제 스크래핑 로직 (Internal)
 * @returns {Promise<Object>} 결과 페이로드 반환 (sendResponse에 전달할 객체)
 */
async function performScrapingInternal(url, normalizedUrl, collectionType) {
    let targetTab = null;
    let createdNewTab = false;

    // 1. 탭 열기
    const result = await openDedicatedScrapeTab(url);
    targetTab = result.tab;
    createdNewTab = result.isNew;

    if (!targetTab) {
        throw new Error('Failed to create or find target tab');
    }

    // 2. 로딩 대기
    console.log(`[ServiceWorker] Waiting for tab ${targetTab.id} to load...`);
    await waitForTabLoad(targetTab.id);

    // 3. 안정화 대기
    console.log('[ServiceWorker] Page stabilization delay (3000ms)...');
    await delay(3000);

    // 4. 수집 시작 명령 전송
    console.log(`[ServiceWorker] Sending EXT_SCRAPE_NOW to tab ${targetTab.id}`);
    const startResponse = await sendMessageToTabWithRetry(targetTab.id, { action: "EXT_SCRAPE_NOW" });

    // 5. 시작 응답 검증
    if (!startResponse || startResponse.status !== 'started') {
        // 레거시 호환 (즉시 데이터가 오는 경우)
        if (startResponse && (startResponse.name || startResponse.title)) {
            const finalPayload = await processScrapedData(startResponse, targetTab, collectionType, createdNewTab);
            return { type: 'SOURCING_COMPLETE', payload: { ...startResponse, logMessage: '[수집완료] (Sync Legacy)' } };
        }
        throw new Error('수집 시작 응답이 올바르지 않습니다.');
    }

    console.log(`[ServiceWorker] Scrape started on tab ${targetTab.id}. Waiting for async completion...`);

    // 6. 결과 대기 (Promise)
    const scrapeData = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            if (pendingScrapes.has(targetTab.id)) {
                pendingScrapes.delete(targetTab.id);
                reject(new Error('Timeout: 수집 시간이 너무 오래 걸립니다 (300초 초과).'));
            }
        }, 300000); // 300초

        pendingScrapes.set(targetTab.id, { resolve, reject, timer, url });
    });

    console.log("[ServiceWorker] Async Scraped Data Received:", scrapeData.name);

    // 7. 데이터 처리 및 저장
    const finalPayload = await processScrapedData(scrapeData, targetTab, collectionType, createdNewTab);

    return { type: 'SOURCING_COMPLETE', payload: finalPayload };
}


/**
 * [ASYNC] 수집 완료 핸들러
 */
function handleAutoScrapeDone(message, sender, sendResponse) {
    const tabId = sender.tab ? sender.tab.id : message.tabId;
    if (!tabId || !pendingScrapes.has(tabId)) {
        console.warn('[ServiceWorker] 알 수 없는 탭에서의 완료 메시지:', tabId);
        return;
    }

    const { resolve, timer } = pendingScrapes.get(tabId);
    clearTimeout(timer);
    pendingScrapes.delete(tabId);

    resolve(message.data);
    sendResponse({ received: true });
}

/**
 * [ASYNC] 수집 에러 핸들러
 */
function handleAutoScrapeError(message, sender, sendResponse) {
    const tabId = sender.tab ? sender.tab.id : message.tabId;
    if (!tabId || !pendingScrapes.has(tabId)) {
        return;
    }

    const { reject, timer } = pendingScrapes.get(tabId);
    clearTimeout(timer);
    pendingScrapes.delete(tabId);

    reject(new Error(message.error || 'Unknown error from content script'));
    sendResponse({ received: true });
}

/**
 * 수집 데이터 처리 및 DB 저장 (공통 로직 분리)
 */
async function processScrapedData(data, targetTab, collectionType, shouldCloseTab) {
    let saveResult = { saved: false, error: null };

    // [AUTO SAVE]
    try {
        if (data.skipped) {
            console.log('[ServiceWorker] 수집 제외:', data.reason);
            saveResult.skipped = true;
            saveResult.error = data.reason;
        } else {
            // Update collection_type (Force overwrite to ensure consistency)
            console.log(`[ServiceWorker] Saving Product with Collection Type: ${collectionType}`);
            if (collectionType) {
                data.collection_type = collectionType;
            } else if (!data.collection_type) {
                data.collection_type = 'single'; // Fallback
            }

            const client = await initializeSupabase();
            const savedData = await client.saveProduct(data);

            console.log("[ServiceWorker] Auto saved:", data.name);
            saveResult.saved = true;
            if (savedData && savedData.product_id) {
                saveResult.productId = savedData.product_id;
            }

            chrome.notifications.create({
                type: 'basic',
                iconUrl: chrome.runtime.getURL('assets/icons/icon48.png'),
                title: '자동 수집 완료',
                message: `${data.name} 저장됨`,
                silent: true
            });
        }
    } catch (saveErr) {
        console.error("[ServiceWorker] DB Save Failed:", saveErr);
        saveResult.error = saveErr.message;

        chrome.notifications.create({
            type: 'basic',
            iconUrl: chrome.runtime.getURL('assets/icons/icon48.png'),
            title: '저장 실패',
            message: `오류: ${saveResult.error}`,
            silent: true
        });
    }

    // 탭 닫기 (새로 만든 탭인 경우만)
    if (shouldCloseTab && targetTab && targetTab.id) {
        try {
            await safeTabOperation(() => chrome.tabs.remove(targetTab.id));
        } catch (e) { }
    }

    return {
        ...data,
        autoSave: saveResult,
        logMessage: saveResult.saved
            ? `[수집완료] ${data.name}`
            : (saveResult.skipped ? `[제외] ${saveResult.error}` : `[저장실패] ${saveResult.error}`)
    };
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
        const tab = await safeTabOperation(() => chrome.tabs.create({ url: searchUrl, active: true }));
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
            reviewCount: item.reviewCount || 0,
            collection_type: 'keyword'
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
        await safeTabOperation(() => chrome.tabs.remove(tabId));

        return limitedItems;

    } catch (error) {
        console.error('[ServiceWorker] performSourcing 에러:', error);
        if (tabId) try { await safeTabOperation(() => chrome.tabs.remove(tabId)); } catch (e) { } // 에러 시에도 탭 정리
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
                await safeTabOperation(() => chrome.tabs.update(tab.id, { active: true }));


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

/**
 * 안전한 탭 작업 (드래그 중 에러 등 방지)
 */
async function safeTabOperation(operation, retries = 5, delayMs = 500) {
    for (let i = 0; i < retries; i++) {
        try {
            return await operation();
        } catch (error) {
            const isEditError = error.message && error.message.includes('Tabs cannot be edited');
            if (isEditError && i < retries - 1) {
                console.warn(`[ServiceWorker] Tab editing blocked, retrying in ${delayMs}ms... (Attempt ${i + 1}/${retries})`);
                await delay(delayMs);
                continue;
            }
            throw error;
        }
    }
}
