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
        console.log('[ServiceWorker] Supabase 초기화 완료');
        return supabaseClient;
    } catch (error) {
        console.error('[ServiceWorker] Supabase 초기화 실패:', error);
        return null;
    }
}

// 초기화
chrome.runtime.onInstalled.addListener(() => {
    console.log('[ServiceWorker] 설치 완료');
    initializeSupabase();
});

// 시작 시(브라우저 시작 시) 체크
chrome.runtime.onStartup.addListener(async () => {
    console.log('[ServiceWorker] 브라우저 시작됨');
    const result = await chrome.storage.local.get(['keepLogin']);
    if (!result.keepLogin) {
        const client = await initializeSupabase();
        if (client) {
            await client.signOut();
            console.log('[ServiceWorker] 로그인 상태 유지 미체크로 세션 초기화');
        }
    }
});

// 초기화
initializeSupabase();

/**
 * 메시지 리스너
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[ServiceWorker] 메시지 수신:', message.action);

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
    }
});

/**
 * 상품 저장 처리 (Supabase)
 */
async function handleSaveProduct(productData, sendResponse) {
    try {
        console.log('[ServiceWorker] 상품 저장 시작:', productData.name);

        const client = await initializeSupabase();

        // Supabase에 저장
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
        console.log('[ServiceWorker] 배치 수집 시작, Progress Window ID:', progressWindowId);

        // Progress 창이 완전히 로드될 때까지 대기
        console.log('[ServiceWorker] Progress 창 로딩 대기 중...');
        await delay(1500);
        console.log('[ServiceWorker] Progress 창 로딩 완료');

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
                console.log(`[ServiceWorker] 제외: ${tab.url}`);
                return false;
            }
            console.log(`[ServiceWorker] 포함: ${tab.url}`);
            return true;
        });

        console.log(`[ServiceWorker] 일반 웹 페이지 탭: ${tabs.length}개`);

        // 3. 상품 페이지 탭만 필터링
        const productTabs = tabs.filter(tab => {
            const isProduct = isProductPage(tab.url);
            console.log(`[ServiceWorker] ${tab.url} -> ${isProduct ? '✅ 상품' : '❌ 일반'}`);
            return isProduct;
        });

        console.log(`[ServiceWorker] 상품 페이지 탭 ${productTabs.length}개 발견`);

        if (productTabs.length === 0) {
            sendResponse({
                success: false,
                error: '수집 가능한 상품 페이지가 없습니다.'
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
                console.log(`[ServiceWorker] === 탭 ${current}/${productTabs.length} 수집 시작 ===`);
                console.log(`[ServiceWorker] URL: ${tab.url}`);
                console.log(`[ServiceWorker] Title: ${tab.title}`);

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
                console.log(`[ServiceWorker] 탭 활성화 완료`);

                // 탭이 완전히 로드될 때까지 대기 (최대 10초)
                await waitForTabLoad(tab.id);
                console.log(`[ServiceWorker] 탭 로드 완료`);

                await delay(2000); // 페이지 안정화 대기

                // 수집 메시지 전송 (재시도 로직 포함)
                console.log(`[ServiceWorker] 수집 메시지 전송 시작...`);
                const collectResponse = await sendMessageToTabWithRetry(tab.id, {
                    action: 'trigger_product',
                    collection_type: 'batch'
                });
                console.log(`[ServiceWorker] 수집 응답:`, collectResponse);

                if (collectResponse && collectResponse.success) {
                    console.log(`[ServiceWorker] ✅ 탭 ${current} 수집 성공`);
                    results.success++;
                } else {
                    throw new Error(collectResponse?.error || '수집 실패');
                }

                // 다음 탭으로 이동하기 전 대기 (저장 완료 보장)
                console.log(`[ServiceWorker] 다음 탭 대기 중...`);
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

        console.log('[ServiceWorker]배치 수집 완료:', results);

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
            // 1. 메시지 전송 시도
            return await chrome.tabs.sendMessage(tabId, message);
        } catch (error) {
            // 2. 연결 실패 시 스크립트 주입 시도 (첫 번째 실패 시에만)
            if (i === 0 && error.message.includes('Could not establish connection')) {
                console.log(`[ServiceWorker] 탭 ${tabId}에 스크립트 주입 시도...`);
                try {
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
                    console.log(`[ServiceWorker] 모든 스크립트 주입 완료`);
                    await delay(1000); // 스크립트 초기화 대기 (늘림)
                    continue; // 재시도
                } catch (scriptError) {
                    console.error('[ServiceWorker] 스크립트 주입 실패:', scriptError);
                }
            }

            // 3. 마지막 시도면 에러 throw
            if (i === retries - 1) throw error;

            // 4. 대기 후 재시도
            await delay(1000);
        }
    }
}

console.log('[ServiceWorker] 로드 완료');
