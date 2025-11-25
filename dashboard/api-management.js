/**
 * API 관리 페이지
 */

const platforms = [
    { id: 'naver', name: '네이버 스마트스토어', icon: 'N', color: '#03C75A' },
    { id: 'coupang', name: '쿠팡', icon: 'C', color: '#E31E24' },
    { id: 'cafe24', name: '카페24', icon: '24', color: '#2F94D0' },
    { id: 'godo', name: '고도몰', icon: 'G', color: '#FF6B00' }
];

let apis = [];

document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    loadAPIs();
    setupEventListeners();
});

function initSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const toggle = document.getElementById('sidebar-toggle');

    if (sidebar && toggle) {
        const collapsed = localStorage.getItem('sidebarCollapsed') !== 'false';
        if (collapsed) sidebar.classList.add('collapsed');

        toggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
        });
    }
}

async function loadAPIs() {
    const result = await chrome.storage.local.get(['apiCredentials']);
    apis = result.apiCredentials || [];
    renderAPIGrid();
}

function renderAPIGrid() {
    const grid = document.getElementById('api-grid');

    const html = platforms.map(platform => {
        const api = apis.find(a => a.platform === platform.id);
        const configured = !!api;

        return `
            <div class="api-card ${configured ? 'configured' : ''}" data-platform="${platform.id}">
                <div class="api-icon" style="background: ${platform.color}">${platform.icon}</div>
                <h3>${platform.name}</h3>
                <div class="api-status">
                    ${configured ?
                '<span class="status-badge success">연결됨</span>' :
                '<span class="status-badge">미연결</span>'
            }
                </div>
                <div class="api-actions">
                    ${configured ?
                `<button class="btn small secondary" data-action="test" data-platform="${platform.id}">테스트</button>
                         <button class="btn small" data-action="edit" data-platform="${platform.id}">수정</button>
                         <button class="btn small danger" data-action="delete" data-platform="${platform.id}">삭제</button>` :
                `<button class="btn small primary" data-action="add" data-platform="${platform.id}">추가</button>`
            }
                </div>
            </div>
        `;
    }).join('');

    grid.innerHTML = html;
}

function setupEventListeners() {
    // API 카드 액션 버튼
    document.getElementById('api-grid').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;

        const action = btn.dataset.action;
        const platform = btn.dataset.platform;

        switch (action) {
            case 'add':
            case 'edit':
                openModal(platform);
                break;
            case 'test':
                testConnection(platform);
                break;
            case 'delete':
                deleteAPI(platform);
                break;
        }
    });

    // 모달
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('api-form').addEventListener('submit', saveAPI);
    document.getElementById('test-connection').addEventListener('click', testFromForm);
}

function openModal(platformId) {
    const modal = document.getElementById('api-modal');
    const api = apis.find(a => a.platform === platformId);

    document.getElementById('platform').value = platformId;
    document.getElementById('api-key').value = api?.apiKey || '';
    document.getElementById('api-secret').value = api?.apiSecret || '';
    document.getElementById('endpoint-url').value = api?.endpoint || '';

    document.getElementById('modal-title').textContent = api ? 'API 수정' : 'API 추가';
    modal.style.display = 'flex';
}

function closeModal() {
    document.getElementById('api-modal').style.display = 'none';
    document.getElementById('api-form').reset();
}

async function saveAPI(e) {
    e.preventDefault();

    const platform = document.getElementById('platform').value;
    const apiKey = document.getElementById('api-key').value;
    const apiSecret = document.getElementById('api-secret').value;
    const endpoint = document.getElementById('endpoint-url').value;

    const existingIndex = apis.findIndex(a => a.platform === platform);
    const newApi = { platform, apiKey, apiSecret, endpoint, updatedAt: new Date().toISOString() };

    if (existingIndex >= 0) {
        apis[existingIndex] = newApi;
    } else {
        apis.push(newApi);
    }

    await chrome.storage.local.set({ apiCredentials: apis });

    closeModal();
    loadAPIs();
    alert('저장되었습니다.');
}

async function testConnection(platformId) {
    const api = apis.find(a => a.platform === platformId);
    if (!api) return;

    alert('연결 테스트 중...');

    // API Manager를 통한 테스트
    const result = await chrome.runtime.sendMessage({
        action: 'testAPIConnection',
        platform: platformId
    });

    if (result?.success) {
        alert('✓ 연결 성공!');
    } else {
        alert('✗ 연결 실패: ' + (result?.error || 'Unknown error'));
    }
}

function testFromForm() {
    const platform = document.getElementById('platform').value;
    if (!platform) {
        alert('플랫폼을 선택하세요.');
        return;
    }
    testConnection(platform);
}

async function deleteAPI(platformId) {
    if (!confirm('정말 삭제하시겠습니까?')) return;

    apis = apis.filter(a => a.platform !== platformId);
    await chrome.storage.local.set({ apiCredentials: apis });
    loadAPIs();
    alert('삭제되었습니다.');
}
