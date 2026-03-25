/**
 * Popup 스크립트 (Auth & Stats)
 */

document.addEventListener('DOMContentLoaded', async () => {
    await loadSavedId();
    await checkLoginStatus();
    setupEventListeners();

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

    document.getElementById('mode-store').addEventListener('click', () => triggerMode('trigger_store', { collection_type: 'store' }));

    // 배치 수집 버튼
    document.getElementById('mode-batch').addEventListener('click', startBatchCollection);
    document.getElementById('batch-cancel').addEventListener('click', cancelBatchCollection);
    document.getElementById('result-close').addEventListener('click', closeBatchResult);

    // 중복 상품 보기 버튼
    document.getElementById('view-duplicate-btn').addEventListener('click', openDashboard);

    // 배치 진행 상황 수신
    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'batchProgress') {
            updateBatchProgress(message.data);
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
            await loadStats();
            await checkDuplicateProduct(); // 중복 체크 추가
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
        if (error.message.includes('Extension context invalidated')) {

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
        alert('활성 탭을 찾을 수 없습니다.');
        return;
    }

    // Chrome 내부 페이지 체크
    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('about:') || tab.url.startsWith('edge://'))) {
        alert('이 페이지에서는 수집 기능을 사용할 수 없습니다.\n\n상품 페이지(알리익스프레스, 타오바오, 1688 등)로 이동한 후 다시 시도해주세요.');
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
            alert(`[수집 불가] ${reason}\n관리자에게 문의해주세요.`);
            return;
        }

        // Content script 로드 확인
        try {
            await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
        } catch (pingError) {
            hideLoading();
            alert('페이지 준비가 필요합니다.\n\n현재 페이지를 새로고침(F5)한 후 다시 시도해주세요.');
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
            alert('성공: ' + msg);
            await loadStats();
        } else {
            if (action === 'trigger_keyword') return;
            const errorMsg = (response && response.error) ? response.error : '알 수 없는 오류가 발생했습니다.';
            alert('실패: ' + errorMsg);
        }
    } catch (error) {
        console.error('모드 실행 오류:', error);
        hideLoading();

        const errorMessage = error.message || String(error);
        if (errorMessage.indexOf('Could not establish connection') >= 0) {
            alert('페이지와 연결할 수 없습니다.\n\n해결 방법:\n1. 페이지를 새로고침(F5)한 후 다시 시도\n2. 상품 페이지(알리익스프레스, 타오바오 등)로 이동\n3. 확장 프로그램 새로고침');
        } else {
            alert('오류가 발생했습니다: ' + errorMessage);
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
