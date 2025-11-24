/**
 * 설정 페이지 로직
 */

const SettingsManager = {
    // 기본 설정
    defaultSettings: {
        targetSites: ['naver', 'coupang'], // 기본 활성화 플랫폼
        exportMode: 'local',
        googleSheets: {
            spreadsheetId: '',
            sheetName: 'Products'
        }
    },

    // 지원 플랫폼 목록
    platforms: [
        { id: 'naver', name: '네이버', icon: '🇳' },
        { id: 'coupang', name: '쿠팡', icon: '🚀' },
        { id: 'gmarket', name: 'G마켓', icon: '🇬' },
        { id: 'auction', name: '옥션', icon: '🅰️' },
        { id: '11st', name: '11번가', icon: '1️⃣' },
        { id: 'aliexpress', name: '알리익스프레스', icon: '🇨🇳' },
        { id: 'temu', name: '테무', icon: '🇹' },
        { id: '1688', name: '1688', icon: '🏭' },
        { id: 'taobao', name: '타오바오', icon: '🛒' }
    ],

    // 현재 설정 상태
    currentSettings: null,

    // 초기화
    init() {
        this.loadSettings();
        this.setupEventListeners();
    },

    // 설정 불러오기
    loadSettings() {
        console.log('SettingsManager: Loading settings...');
        chrome.storage.sync.get('settings', (data) => {
            console.log('SettingsManager: Settings loaded', data);
            this.currentSettings = data.settings || this.defaultSettings;
            this.renderSettings();
        });
    },

    // 설정 렌더링
    renderSettings() {
        console.log('SettingsManager: Rendering settings...');
        if (!this.currentSettings) {
            console.error('SettingsManager: No settings to render');
            return;
        }

        // 1. 플랫폼 목록 렌더링
        this.renderPlatforms();

        // 2. 내보내기 모드 설정
        const exportModeRadios = document.getElementsByName('export-mode');
        exportModeRadios.forEach(radio => {
            radio.checked = radio.value === this.currentSettings.exportMode;
        });

        // 3. 구글 시트 설정 표시 여부
        this.toggleGoogleSheetsSettings(this.currentSettings.exportMode === 'googleSheets');

        // 4. 구글 시트 설정 값 채우기
        if (this.currentSettings.googleSheets) {
            document.getElementById('spreadsheet-id').value = this.currentSettings.googleSheets.spreadsheetId || '';
            document.getElementById('sheet-name').value = this.currentSettings.googleSheets.sheetName || 'Products';
        }

        // 5. 인증 상태 확인
        this.checkAuthStatus();
    },

    // 플랫폼 목록 렌더링
    renderPlatforms() {
        const grid = document.getElementById('platform-grid');
        if (!grid) return;

        grid.innerHTML = '';
        const selectedSites = this.currentSettings.targetSites || [];

        this.platforms.forEach(platform => {
            const isChecked = selectedSites.includes(platform.id);

            const card = document.createElement('div');
            card.className = 'platform-card';
            card.innerHTML = `
                <input type="checkbox" id="platform-${platform.id}" class="platform-checkbox" value="${platform.id}" ${isChecked ? 'checked' : ''}>
                <label for="platform-${platform.id}" class="platform-label">
                    <span class="check-indicator">✓</span>
                    <span class="platform-icon">${platform.icon}</span>
                    <span class="platform-name">${platform.name}</span>
                </label>
            `;
            grid.appendChild(card);

            // 체크박스 이벤트 리스너
            const checkbox = card.querySelector('input');
            checkbox.addEventListener('change', (e) => {
                this.updateTargetSites(platform.id, e.target.checked);
            });
        });
    },

    // 대상 사이트 업데이트
    updateTargetSites(platformId, isChecked) {
        if (!this.currentSettings.targetSites) {
            this.currentSettings.targetSites = [];
        }

        if (isChecked) {
            if (!this.currentSettings.targetSites.includes(platformId)) {
                this.currentSettings.targetSites.push(platformId);
            }
        } else {
            this.currentSettings.targetSites = this.currentSettings.targetSites.filter(id => id !== platformId);
        }
    },

    // 구글 시트 설정 토글
    toggleGoogleSheetsSettings(show) {
        const settingsDiv = document.getElementById('google-sheets-settings');
        if (settingsDiv) {
            settingsDiv.style.display = show ? 'block' : 'none';
        }
    },

    // 이벤트 리스너 설정
    setupEventListeners() {
        // 내보내기 모드 변경
        const exportModeRadios = document.getElementsByName('export-mode');
        exportModeRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                const mode = e.target.value;
                this.currentSettings.exportMode = mode;
                this.toggleGoogleSheetsSettings(mode === 'googleSheets');
            });
        });

        // 구글 인증 버튼
        const authBtn = document.getElementById('auth-google-btn');
        if (authBtn) {
            authBtn.addEventListener('click', () => this.handleAuth());
        }

        // 설정 저장 버튼
        const saveBtn = document.getElementById('save-settings-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveSettings());
        }

        // 취소 버튼
        const cancelBtn = document.getElementById('cancel-settings-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                if (confirm('변경사항을 취소하고 돌아가시겠습니까?')) {
                    this.loadSettings(); // 설정 원복
                    // 대시보드로 이동 (dashboard.js의 switchView 사용)
                    const productsLink = document.querySelector('.nav-item[data-view="products"]');
                    if (productsLink) productsLink.click();
                }
            });
        }
    },

    // 설정 저장
    saveSettings() {
        // 구글 시트 설정 업데이트
        if (this.currentSettings.exportMode === 'googleSheets') {
            const spreadsheetId = document.getElementById('spreadsheet-id').value;
            const sheetName = document.getElementById('sheet-name').value;

            if (!spreadsheetId) {
                alert('스프레드시트 ID를 입력해주세요.');
                return;
            }

            this.currentSettings.googleSheets = {
                spreadsheetId,
                sheetName
            };
        }

        // 저장
        chrome.storage.sync.set({ settings: this.currentSettings }, () => {
            alert('설정이 저장되었습니다.');
            // 대시보드로 이동
            const productsLink = document.querySelector('.nav-item[data-view="products"]');
            if (productsLink) productsLink.click();
        });
    },

    // 구글 인증 처리
    handleAuth() {
        chrome.identity.getAuthToken({ interactive: true }, (token) => {
            if (chrome.runtime.lastError) {
                console.error(chrome.runtime.lastError);
                alert('인증 실패: ' + chrome.runtime.lastError.message);
                return;
            }

            console.log('Token acquired:', token);
            this.checkAuthStatus();

            // 시트 설정 영역 표시
            const sheetConfig = document.getElementById('sheet-config');
            if (sheetConfig) sheetConfig.style.display = 'block';
        });
    },

    // 인증 상태 확인
    checkAuthStatus() {
        chrome.identity.getAuthToken({ interactive: false }, (token) => {
            const statusDiv = document.getElementById('auth-status');
            const authBtn = document.getElementById('auth-google-btn');
            const sheetConfig = document.getElementById('sheet-config');

            if (chrome.runtime.lastError || !token) {
                statusDiv.className = 'auth-status';
                statusDiv.innerHTML = '<span class="status-icon">🔒</span><span class="status-text">연동되지 않음</span>';
                authBtn.textContent = '구글 계정 연동';
                if (sheetConfig) sheetConfig.style.display = 'none';
            } else {
                statusDiv.className = 'auth-status connected';
                statusDiv.innerHTML = '<span class="status-icon">✅</span><span class="status-text">연동됨</span>';
                authBtn.textContent = '계정 다시 연동';
                if (sheetConfig) sheetConfig.style.display = 'block';
            }
        });
    }
};
