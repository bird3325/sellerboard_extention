/**
 * Popup 스크립트 (Auth & Stats)
 */

document.addEventListener('DOMContentLoaded', async () => {
    await loadSavedId();
    await checkLoginStatus();
    setupEventListeners();
    await updateCartCount();

    // 주기적 로그인 체크 (30초마다)
    setInterval(checkLoginStatus, 30000);
});

/**
 * 이벤트 리스너 설정
 */
function setupEventListeners() {
    // 로그인
    document.getElementById('login-btn').addEventListener('click', handleLogin);

    // 로그아웃
    document.getElementById('logout-btn').addEventListener('click', handleLogout);

    // 대시보드
    document.getElementById('dashboard-btn').addEventListener('click', openDashboard);

    // 엔터키 로그인 지원
    document.getElementById('password').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });

    // 비밀번호 보기 토글
    document.getElementById('toggle-password').addEventListener('click', togglePasswordVisibility);

    // 외부 링크 처리
    const links = document.querySelectorAll('.links a');
    links.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const url = 'https://sellerboard.com/find-account';
            chrome.tabs.create({ url });
        });
    });

    // 수집 모드 버튼 이벤트
    document.getElementById('mode-product').addEventListener('click', () => triggerMode('trigger_product', { collection_type: 'single' }));
    document.getElementById('mode-keyword').addEventListener('click', async () => {
        const keyword = prompt('수집할 키워드를 입력하세요:');
        if (keyword) {
            triggerMode('trigger_keyword', { keyword, collection_type: 'keyword' });
        }
    });

    // 담기 수집 모드 버튼 클릭 시 목록 토글
    document.getElementById('mode-store').addEventListener('click', toggleCartList);

    // 담기 목록 일괄 저장 및 일괄 삭제
    document.getElementById('btn-collect-all-cart').addEventListener('click', startCartCollection);
    document.getElementById('btn-clear-all-cart').addEventListener('click', clearAllCart);

    // 배치 수집 버튼
    document.getElementById('mode-batch').addEventListener('click', startBatchCollection);
    document.getElementById('batch-cancel').addEventListener('click', cancelBatchCollection);
    document.getElementById('result-close').addEventListener('click', closeBatchResult);

    // 중복 상품 보기 버튼
    document.getElementById('view-duplicate-btn').addEventListener('click', openDashboard);

    // 배치 진행 상황 수신 및 완료 처리
    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'batchProgress') {
            updateBatchProgress(message.data);
        } else if (message.action === 'batchComplete') {
            // 수집 완료 시, 담기 수집인 경우 카운트 및 목록 초기화
            chrome.storage.local.set({ cart_items: [] }, () => {
                updateCartCount();
                renderCartList();
            });
        }
    });
}



/**
 * 로딩 표시
 */
function showLoading() {
    document.getElementById('loading-overlay').style.display = 'flex';

    // 모든 버튼 비활성화
    const buttons = document.querySelectorAll('.mode-btn, .btn-logout, .btn-primary, .btn-dashboard');
    buttons.forEach(btn => btn.disabled = true);
}

/**
 * 로딩 숨김
 */
function hideLoading() {
    document.getElementById('loading-overlay').style.display = 'none';

    // 모든 버튼 재활성화
    const buttons = document.querySelectorAll('.mode-btn, .btn-logout, .btn-primary, .btn-dashboard');
    buttons.forEach(btn => btn.disabled = false);
}

/**
 * 비밀번호 보기 토글
 */
function togglePasswordVisibility() {
    const passwordInput = document.getElementById('password');
    const toggleBtn = document.getElementById('toggle-password');

    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        toggleBtn.textContent = '🔒';
    } else {
        passwordInput.type = 'password';
        toggleBtn.textContent = '👁️';
    }
}

/**
 * 저장된 아이디 불러오기
 */
async function loadSavedId() {
    const result = await chrome.storage.local.get(['savedEmail', 'keepLogin']);

    if (result.savedEmail) {
        document.getElementById('email').value = result.savedEmail;
        document.getElementById('save-id').checked = true;
    }

    if (result.keepLogin) {
        document.getElementById('keep-login').checked = true;
    }
}

/**
 * 로그인 상태 확인
 */
async function checkLoginStatus() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getSession' });

        if (response && response.session) {
            showProfile(response.session.user);
            // 통계 로드와 중복 체크는 팝업 UI 표시 후 비동기로 안전하게 실행되도록 수정
            loadStats().catch(err => console.error('통계 로드 실패:', err));
            checkDuplicateProduct().catch(err => console.error('중복 체크 실패:', err));
        } else {
            // 로그아웃 상태 - 항상 로그인 화면으로 전환
            showLogin();
            // 비밀번호 필드 초기화 및 메시지 숨김
            document.getElementById('password').value = '';
            const msgEl = document.getElementById('login-message');
            msgEl.textContent = '';
            msgEl.style.display = 'none';
        }
    } catch (error) {
        console.error('세션 확인 실패:', error);

        // 확장 프로그램 컨텍스트 무효화 감지
        if (error?.message?.includes('Extension context invalidated')) {

            window.location.reload();
            return;
        }

        showLogin();
    }
}

/**
 * 로그인 처리
 */
async function handleLogin() {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value.trim();
    const saveIdChecked = document.getElementById('save-id').checked;
    const keepLoginChecked = document.getElementById('keep-login').checked;
    const messageEl = document.getElementById('login-message');

    if (!email || !password) {
        showMessage(messageEl, '이메일과 비밀번호를 입력해주세요.', 'error');
        return;
    }

    showMessage(messageEl, '로그인 중...', 'info');

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'signIn',
            email,
            password
        });

        if (response.success) {
            if (saveIdChecked) {
                await chrome.storage.local.set({ savedEmail: email });
            } else {
                await chrome.storage.local.remove(['savedEmail']);
            }

            await chrome.storage.local.set({ keepLogin: keepLoginChecked });

            showMessage(messageEl, '로그인 성공!', 'success');
            showProfile(response.user);
            await loadStats();
        } else {
            showMessage(messageEl, '로그인 실패: ' + response.error, 'error');
        }
    } catch (error) {
        console.error('로그인 오류:', error);
        showMessage(messageEl, '로그인 중 오류가 발생했습니다.', 'error');
    }
}

/**
 * 로그아웃 처리
 */
async function handleLogout() {
    try {
        await chrome.runtime.sendMessage({ action: 'signOut' });
        showLogin();

        const result = await chrome.storage.local.get(['savedEmail']);
        if (!result.savedEmail) {
            document.getElementById('email').value = '';
        }
        document.getElementById('password').value = '';
        document.getElementById('login-message').style.display = 'none';

        const safeSetText = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        };

        safeSetText('total-count', '-');
        safeSetText('today-count', '-');
    } catch (error) {
        console.error('로그아웃 오류:', error);
    }
}

/**
 * 대시보드 열기
 */
function openDashboard() {
    const dashboardUrl = 'https://sellerboard.vercel.app/';
    chrome.tabs.create({ url: dashboardUrl });
}

/**
 * 수집 모드 실행
 */
async function triggerMode(action, data) {
    data = data || {};

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];

    if (!tab) {
        await showConfirmModal('알림', '활성 탭을 찾을 수 없습니다.', true);
        return;
    }

    // Chrome 내부 페이지 체크
    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('about:') || tab.url.startsWith('edge://'))) {
        await showConfirmModal('알림', '이 페이지에서는 수집 기능을 사용할 수 없습니다.\n\n상품 페이지(알리익스프레스, 타오바오, 1688 등)로 이동한 후 다시 시도해주세요.', true);
        return;
    }

    // 로딩 시작
    showLoading();

    try {
        // 0. 플랫폼 활성 상태 체크 (전체 레이아웃 유지하며 로직 보강)
        const platformId = PlatformDetector.detect(tab.url);

        const platformStatus = await chrome.runtime.sendMessage({
            action: 'checkPlatformActive',
            platformId: platformId
        });

        if (!platformStatus || !platformStatus.isActive) {
            hideLoading();
            const reason = !platformStatus || !platformStatus.isListed ?
                '등록되지 않은 플랫폼입니다.' : '현재 비활성화된 플랫폼입니다.';
            await showConfirmModal('수집 불가', `[수집 불가] ${reason}\n관리자에게 문의해주세요.`, true);
            return;
        }

        // Content script 로드 확인
        try {
            await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
        } catch (pingError) {
            hideLoading();
            await showConfirmModal('알림', '페이지 준비가 필요합니다.\n\n현재 페이지를 새로고침(F5)한 후 다시 시도해주세요.', true);
            return;
        }

        // 실제 작업 수행
        const message = { action: action, collection_type: data.collection_type };
        if (data.keyword) {
            message.keyword = data.keyword;
        }

        const response = await chrome.tabs.sendMessage(tab.id, message);



        hideLoading();

        if (response && response.success) {


            const msg = response.message || '작업이 완료되었습니다.';
            await showConfirmModal('성공', msg, true);
            await loadStats();
        } else {
            if (action === 'trigger_keyword') return;
            const errorMsg = (response && response.error) ? response.error : '알 수 없는 오류가 발생했습니다.';
            await showConfirmModal('실패', errorMsg, true);
        }
    } catch (error) {
        console.error('모드 실행 오류:', error);
        hideLoading();

        const errorMessage = error.message || String(error);
        if (errorMessage.indexOf('Could not establish connection') >= 0) {
            await showConfirmModal('오류', '페이지와 연결할 수 없습니다.\n\n해결 방법:\n1. 페이지를 새로고침(F5)한 후 다시 시도\n2. 상품 페이지(알리익스프레스, 타오바오 등)로 이동\n3. 확장 프로그램 새로고침', true);
        } else {
            await showConfirmModal('오류', '오류가 발생했습니다: ' + errorMessage, true);
        }
    }
}

/**
 * 로그인 화면 표시
 */
function showLogin() {
    document.getElementById('login-section').style.display = 'block';
    document.getElementById('profile-section').style.display = 'none';

    // 수집 버튼 비활성화
    const modeBtns = document.querySelectorAll('.mode-btn');
    modeBtns.forEach(btn => btn.disabled = true);
}

/**
 * 프로필 화면 표시
 */
function showProfile(user) {
    document.getElementById('login-section').style.display = 'none';
    document.getElementById('profile-section').style.display = 'block';

    // 수집 버튼 활성화
    const modeBtns = document.querySelectorAll('.mode-btn');
    modeBtns.forEach(btn => btn.disabled = false);
}

/**
 * 통계 불러오기
 */
async function loadStats() {
    try {
        const stats = await chrome.runtime.sendMessage({ action: 'getStats' });

        const safeSetStats = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = (val !== undefined && val !== null) ? val.toLocaleString() : '0';
        };

        safeSetStats('total-count', stats.total);
        safeSetStats('today-count', stats.today);
    } catch (error) {
        console.error('통계 불러오기 실패:', error);
    }
}

/**
 * 중복 상품 체크
 */
async function checkDuplicateProduct() {
    try {
        // 현재 탭의 URL 가져오기
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url) return;

        // 크롬 기본 페이지 등 수집 비대상 페이지는 스킵
        if (tab.url.startsWith('chrome://') || tab.url.startsWith('about:') || tab.url.startsWith('edge://')) {
            const alertEl = document.getElementById('duplicate-alert');
            if (alertEl) alertEl.style.display = 'none';
            return;
        }

        // 상품 상세페이지가 아니거나 generic 플랫폼인 경우 중복 체크 스킵 (목록 페이지 등에서의 멈춤 방지)
        const platformId = PlatformDetector.detect(tab.url);
        if (!platformId || platformId === 'generic') {
            const alertEl = document.getElementById('duplicate-alert');
            if (alertEl) alertEl.style.display = 'none';
            return;
        }

        // 중복 체크
        const result = await chrome.runtime.sendMessage({
            action: 'checkDuplicate',
            url: tab.url
        });

        const alertEl = document.getElementById('duplicate-alert');
        const infoEl = document.getElementById('duplicate-info');

        if (result && result.isDuplicate && result.product) {
            // 중복 상품 정보 표시
            const product = result.product;
            const collectedDate = new Date(product.collected_at).toLocaleDateString('ko-KR');
            infoEl.innerHTML = `
                <strong>상품명:</strong> ${product.name}<br>
                <strong>수집일:</strong> ${collectedDate}
            `;
            alertEl.style.display = 'flex';
        } else {
            // 중복 아님 또는 체크 실패
            alertEl.style.display = 'none';
        }
    } catch (error) {
        // 에러 발생 시 조용히 처리 (알림 숨김)
        const alertEl = document.getElementById('duplicate-alert');
        if (alertEl) {
            alertEl.style.display = 'none';
        }
    }
}

/**
 * 메시지 표시
 */
function showMessage(element, message, type) {
    element.textContent = message;
    element.className = 'status-message ' + type;
    element.style.display = 'block';
}

/**
 * 배치 수집 시작
 */
async function startBatchCollection() {
    try {
        // 프로그레스 창 열기
        const progressWindow = await chrome.windows.create({
            url: chrome.runtime.getURL('progress/progress.html'),
            type: 'popup',
            width: 400,
            height: 500,
            focused: true
        });



        // 배치 수집 요청
        const response = await chrome.runtime.sendMessage({
            action: 'batchCollect',
            progressWindowId: progressWindow.id
        });

        if (!response.success) {
            alert(response.error || '배치 수집 실패');
            // Close progress window on error
            chrome.windows.remove(progressWindow.id);
        }

    } catch (error) {
        console.error('배치 수집 오류:', error);
        alert('배치 수집 중 오류가 발생했습니다.');
    }
}

/**
 * 배치 진행 상황 업데이트
 */
function updateBatchProgress(data) {
    document.getElementById('batch-status').textContent = `${data.current}/${data.total} 완료`;
    document.getElementById('batch-current').textContent = `현재: ${data.currentTab}`;
    document.getElementById('batch-progress-fill').style.width = data.percentage + '%';
    document.getElementById('batch-percentage').textContent = data.percentage + '%';
}

/**
 * 배치 결과 표시
 */
function showBatchResult(results) {
    document.getElementById('result-total').textContent = results.total;
    document.getElementById('result-success').textContent = results.success;
    document.getElementById('result-failed').textContent = results.failed;

    // 제목 변경 (실패가 있으면 경고)
    const title = results.failed > 0 ? '⚠️ 배치 수집 완료 (일부 실패)' : '✅ 배치 수집 완료!';
    document.getElementById('result-title').textContent = title;

    // 결과 모달 표시
    document.getElementById('batch-result-modal').style.display = 'flex';

    // 통계 다시 로드
    loadStats();
}

/**
 * 배치 수집 취소
 */
function cancelBatchCollection() {
    // TODO: 실제 취소 로직 구현 (서비스 워커에 취소 메시지 전송)
    document.getElementById('batch-progress-modal').style.display = 'none';
    alert('배치 수집이 취소되었습니다.');
}

/**
 * 결과 모달 닫기
 */
function closeBatchResult() {
    document.getElementById('batch-result-modal').style.display = 'none';
}

/**
 * 담기 수집 카운트 및 배지 갱신
 */
async function updateCartCount() {
    try {
        const result = await chrome.storage.local.get({ cart_items: [] });
        const count = result.cart_items.length;
        
        const titleEl = document.getElementById('cart-count-title');
        if (titleEl) {
            titleEl.textContent = '담기 수집';
        }

        const badgeEl = document.getElementById('cart-badge');
        if (badgeEl) {
            if (count > 0) {
                badgeEl.textContent = count;
                badgeEl.style.display = 'flex';
            } else {
                badgeEl.style.display = 'none';
            }
        }
    } catch (e) {
        console.error('Failed to update cart count:', e);
    }
}

/**
 * 담기 목록 토글
 */
function toggleCartList() {
    const section = document.getElementById('cart-list-section');
    if (!section) return;

    if (section.style.display === 'none') {
        section.style.display = 'block';
        renderCartList();
    } else {
        section.style.display = 'none';
    }
}

/**
 * 담기 목록 렌더링
 */
async function renderCartList() {
    try {
        const result = await chrome.storage.local.get({ cart_items: [] });
        const cartItems = result.cart_items;
        const listEl = document.getElementById('cart-items-list');
        if (!listEl) return;

        listEl.innerHTML = '';

        if (cartItems.length === 0) {
            listEl.innerHTML = '<li style="padding: 10px 0; text-align: center; color: #999;">담긴 상품이 없습니다.</li>';
            return;
        }

        cartItems.forEach((item, index) => {
            const li = document.createElement('li');
            li.style.display = 'flex';
            li.style.justify = 'space-between';
            li.style.alignItems = 'center';
            li.style.padding = '6px 0';
            li.style.borderBottom = '1px dashed #eef2f5';

            const url = (typeof item === 'object' && item !== null) ? item.url : item;
            const imageUrl = (typeof item === 'object' && item !== null) ? item.imageUrl : '';

            // 이미지와 텍스트 영역
            const infoDiv = document.createElement('div');
            infoDiv.style.display = 'flex';
            infoDiv.style.alignItems = 'center';
            infoDiv.style.gap = '8px';

            if (imageUrl) {
                const imgEl = document.createElement('img');
                imgEl.src = imageUrl;
                imgEl.style.width = '40px';
                imgEl.style.height = '40px';
                imgEl.style.objectFit = 'cover';
                imgEl.style.borderRadius = '4px';
                imgEl.style.border = '1px solid #eef2f5';
                infoDiv.appendChild(imgEl);
            }

            let displayUrl = url;
            try {
                const parsed = new URL(url);
                displayUrl = parsed.hostname + parsed.pathname;
            } catch (e) {}

            const span = document.createElement('span');
            span.textContent = displayUrl;
            span.style.overflow = 'hidden';
            span.style.textOverflow = 'ellipsis';
            span.style.whiteSpace = 'nowrap';
            span.style.maxWidth = '190px';
            span.title = url;
            infoDiv.appendChild(span);

            const actionsDiv = document.createElement('div');
            actionsDiv.style.display = 'flex';
            actionsDiv.style.gap = '6px';

            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = '×';
            deleteBtn.style.background = 'none';
            deleteBtn.style.border = 'none';
            deleteBtn.style.cursor = 'pointer';
            deleteBtn.style.padding = '0 4px';
            deleteBtn.style.fontSize = '14px';
            deleteBtn.style.color = '#95a5a6';
            deleteBtn.style.fontWeight = 'bold';
            deleteBtn.style.lineHeight = '1';
            deleteBtn.style.transition = 'color 0.2s';
            deleteBtn.title = '제거';

            deleteBtn.onmouseover = () => {
                deleteBtn.style.color = '#e74c3c';
            };
            deleteBtn.onmouseout = () => {
                deleteBtn.style.color = '#95a5a6';
            };

            deleteBtn.onclick = async () => {
                const updatedItems = cartItems.filter(ci => {
                    const ciUrl = (typeof ci === 'object' && ci !== null) ? ci.url : ci;
                    return ciUrl !== url;
                });
                await chrome.storage.local.set({ cart_items: updatedItems });
                await updateCartCount();
                renderCartList();
            };

            actionsDiv.appendChild(deleteBtn);
            li.appendChild(infoDiv);
            li.appendChild(actionsDiv);
            listEl.appendChild(li);
        });
    } catch (e) {
        console.error('Failed to render cart list:', e);
    }
}

/**
 * 담기 목록 일괄 삭제
 */
async function clearAllCart() {
    try {
        const result = await chrome.storage.local.get({ cart_items: [] });
        if (result.cart_items.length === 0) {
            await showConfirmModal('알림', '삭제할 상품이 없습니다.', true);
            return;
        }

        const confirmed = await showConfirmModal('일괄 삭제', '담아둔 모든 상품을 목록에서 삭제하시겠습니까?');
        if (confirmed) {
            await chrome.storage.local.set({ cart_items: [] });
            await updateCartCount();
            renderCartList();
        }
    } catch (e) {
        console.error('Failed to clear cart:', e);
    }
}

/**
 * 담기 목록 일괄 저장 실행
 */
let isCartCollecting = false;
async function startCartCollection() {
    if (isCartCollecting) return;

    try {
        const result = await chrome.storage.local.get({ cart_items: [] });
        const cartItems = result.cart_items;

        if (cartItems.length === 0) {
            await showConfirmModal('알림', '담아둔 상품이 없습니다. 상품 목록에서 담기를 먼저 진행해주세요.', true);
            return;
        }

        const confirmed = await showConfirmModal('일괄 수집', '담아둔 모든 상품을 일괄 수집하시겠습니까?');
        if (!confirmed) {
            return;
        }

        isCartCollecting = true;

        // 1. 모든 상세페이지 탭 먼저 백그라운드로 열기 (비활성화 상태로 오픈)
        const tabPromises = cartItems.map(item => {
            const url = (typeof item === 'object' && item !== null) ? item.url : item;
            return chrome.tabs.create({ url, active: false });
        });

        const openedTabs = await Promise.all(tabPromises);

        // 2. 모든 페이지 로드 대기 (최대 15초 대기 헬퍼)
        await Promise.all(openedTabs.map(tab => {
            return new Promise((resolve) => {
                let isResolved = false;
                const checkComplete = () => {
                    chrome.tabs.get(tab.id, (t) => {
                        if (t && t.status === 'complete') {
                            if (!isResolved) {
                                isResolved = true;
                                resolve();
                            }
                        } else if (!isResolved) {
                            setTimeout(checkComplete, 500);
                        }
                    });
                };
                checkComplete();
                // 15초 강제 타임아웃 방지책
                setTimeout(() => {
                    if (!isResolved) {
                        isResolved = true;
                        resolve();
                    }
                }, 15000);
            });
        }));

        // 3. 모든 상세페이지가 완전히 다 열린 후, 팝업 진행창 (Progress Window) 열기
        const progressWindow = await chrome.windows.create({
            url: chrome.runtime.getURL('progress/progress.html'),
            type: 'popup',
            width: 400,
            height: 500,
            focused: true
        });

        // 4. 백그라운드로 일괄 배치 수집 실행 요청
        const response = await chrome.runtime.sendMessage({
            action: 'batchCollect',
            progressWindowId: progressWindow.id,
            isCart: true
        });

        if (response && response.success) {
            // 배치 수집이 성공적으로 종료되면, 담기 목록 비우기 및 UI 갱신
            await chrome.storage.local.set({ cart_items: [] });
            await updateCartCount();
            await renderCartList();
        } else {
            await showConfirmModal('오류', response?.error || '일괄 수집 중 오류가 발생했습니다.', true);
        }

    } catch (error) {
        console.error('담기 수집 중 오류:', error);
        await showConfirmModal('오류', '담기 수집 중 오류가 발생했습니다: ' + error.message, true);
    } finally {
        isCartCollecting = false;
    }
}

/**
 * 커스텀 확인 모달 팝업 표시
 * @param {string} title - 모달 제목
 * @param {string} message - 모달 메시지
 * @param {boolean} okOnly - 확인 버튼만 표시할지 여부
 * @returns {Promise<boolean>} 사용자가 확인(true) 또는 취소(false)를 눌렀는지 여부
 */
function showConfirmModal(title, message, okOnly = false) {
    return new Promise((resolve) => {
        const existing = document.getElementById('custom-confirm-modal');
        if (existing) existing.remove();

        const modalDiv = document.createElement('div');
        modalDiv.id = 'custom-confirm-modal';
        modalDiv.className = 'batch-modal';
        
        modalDiv.innerHTML = `
            <div class="modal-content" style="display: flex; flex-direction: column; gap: 16px; align-items: center;">
                <h3 style="margin: 0; font-size: 16px; color: var(--text-main); font-weight: 700;">${title}</h3>
                <p style="margin: 0; font-size: 13px; color: var(--text-sub); line-height: 1.5; white-space: pre-line;">${message}</p>
                <div style="display: flex; width: 100%; gap: 8px; margin-top: 8px;">
                    ${okOnly ? '' : `<button id="confirm-modal-cancel" style="flex: 1; padding: 10px; background-color: #f1f5f9; color: var(--text-sub); border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.2s;">취소</button>`}
                    <button id="confirm-modal-ok" style="flex: 1; padding: 10px; background-color: var(--primary); color: white; border: none; border-radius: var(--radius-sm); font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.2s;">확인</button>
                </div>
            </div>
        `;

        document.body.appendChild(modalDiv);

        const okBtn = modalDiv.querySelector('#confirm-modal-ok');
        const cancelBtn = modalDiv.querySelector('#confirm-modal-cancel');

        okBtn.onmouseover = () => { okBtn.style.backgroundColor = 'var(--primary-hover)'; };
        okBtn.onmouseout = () => { okBtn.style.backgroundColor = 'var(--primary)'; };
        
        if (cancelBtn) {
            cancelBtn.onmouseover = () => { cancelBtn.style.backgroundColor = '#e2e8f0'; };
            cancelBtn.onmouseout = () => { cancelBtn.style.backgroundColor = '#f1f5f9'; };
            cancelBtn.onclick = () => {
                modalDiv.remove();
                resolve(false);
            };
        }

        okBtn.onclick = () => {
            modalDiv.remove();
            resolve(true);
        };
        
        modalDiv.onclick = (e) => {
            if (e.target === modalDiv) {
                modalDiv.remove();
                resolve(false);
            }
        };
    });
}
