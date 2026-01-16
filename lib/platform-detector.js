/**
 * 플랫폼 감지 시스템
 * URL 패턴 기반으로 현재 페이지의 이커머스 플랫폼을 자동 식별
 */

class PlatformDetector {
    static PLATFORMS = {
        NAVER: 'naver',
        COUPANG: 'coupang',
        GMARKET: 'gmarket',
        AUCTION: 'auction',
        ELEVENST: '11st',
        ALIEXPRESS: 'aliexpress',
        CHINA_1688: '1688',
        TAOBAO: 'taobao',
        GENERIC: 'generic'
    };

    static PATTERNS = {
        [this.PLATFORMS.NAVER]: [
            /smartstore\.naver\.com\/.*\/products\//,
            /shopping\.naver\.com\/.*\/products\//,
            /search\.shopping\.naver\.com\/search/
        ],
        [this.PLATFORMS.COUPANG]: [
            /www\.coupang\.com\/vp\/products\//,
            /www\.coupang\.com\/np\/products\//,
            /www\.coupang\.com\/np\/search/
        ],
        [this.PLATFORMS.GMARKET]: [
            /item\.gmarket\.co\.kr/,
            /www\.gmarket\.co\.kr\/item/,
            /browse\.gmarket\.co\.kr\/search/
        ],
        [this.PLATFORMS.AUCTION]: [
            /itempage3\.auction\.co\.kr/,
            /www\.auction\.co\.kr\/item/,
            /browse\.auction\.co\.kr\/search/
        ],
        [this.PLATFORMS.ELEVENST]: [
            /www\.11st\.co\.kr\/products\//,
            /m\.11st\.co\.kr\/products\//,
            /search\.11st\.co\.kr\/Search/
        ],
        [this.PLATFORMS.ALIEXPRESS]: [
            /www\.aliexpress\.com\/item\//,
            /.*\.aliexpress\.com\/item\//,
            /www\.aliexpress\.com\/wholesale/
        ],
        [this.PLATFORMS.CHINA_1688]: [
            /detail\.1688\.com\/offer\//,
            /.*\.1688\.com\/offer\//,
            /s\.1688\.com\/selloffer\/offer_search/
        ],
        [this.PLATFORMS.TAOBAO]: [
            /item\.taobao\.com\/item\.htm/,
            /detail\.tmall\.com\/item\.htm/,
            /world\.taobao\.com\/item\//,
            /world\.taobao\.com\/item\.htm/,
            /s\.taobao\.com\/search/
        ]
    };

    /**
     * 현재 URL에서 플랫폼 감지
     * @param {string} url - 감지할 URL (기본값: 현재 페이지 URL)
     * @returns {string} 플랫폼 ID
     */
    static detect(url = window.location.href) {
        for (const [platform, patterns] of Object.entries(this.PATTERNS)) {
            for (const pattern of patterns) {
                if (pattern.test(url)) {

                    return platform;
                }
            }
        }


        return this.PLATFORMS.GENERIC;
    }

    /**
     * 사용자 설정에 따라 위젯을 표시해야 하는지 확인
     * @param {string} url - 확인할 URL
     * @param {Object} userSettings - 사용자 설정
     * @returns {boolean} 위젯 표시 여부
     */
    static async shouldShowWidget(url = window.location.href, userSettings = null) {
        const platform = this.detect(url);

        // generic 플랫폼은 항상 숨김
        if (platform === this.PLATFORMS.GENERIC) {
            return false;
        }

        // 사용자 설정이 없으면 가져오기
        if (!userSettings) {
            userSettings = await this.getUserSettings();
        }

        // 대상 플랫폼 목록에 포함되어 있는지 확인
        const targetPlatforms = userSettings?.targetPlatforms || [];
        const shouldShow = targetPlatforms.includes(platform);


        return shouldShow;
    }

    /**
     * 사용자 설정 가져오기
     * @returns {Promise<Object>} 사용자 설정
     */
    static async getUserSettings() {
        return new Promise((resolve) => {
            chrome.storage.sync.get('settings', (result) => {
                resolve(result.settings || { targetPlatforms: [] });
            });
        });
    }

    /**
     * 플랫폼 이름 가져오기
     * @param {string} platformId - 플랫폼 ID
     * @returns {string} 플랫폼 이름
     */
    static getPlatformName(platformId) {
        const names = {
            [this.PLATFORMS.NAVER]: '네이버 스마트스토어',
            [this.PLATFORMS.COUPANG]: '쿠팡',
            [this.PLATFORMS.GMARKET]: 'G마켓',
            [this.PLATFORMS.AUCTION]: '옥션',
            [this.PLATFORMS.ELEVENST]: '11번가',
            [this.PLATFORMS.ALIEXPRESS]: '알리익스프레스',
            [this.PLATFORMS.CHINA_1688]: '1688',
            [this.PLATFORMS.TAOBAO]: '타오바오',
            [this.PLATFORMS.GENERIC]: '일반'
        };

        return names[platformId] || platformId;
    }

    /**
     * 플랫폼이 한국 플랫폼인지 확인
     * @param {string} platformId - 플랫폼 ID
     * @returns {boolean} 한국 플랫폼 여부
     */
    static isKoreanPlatform(platformId) {
        return [
            this.PLATFORMS.NAVER,
            this.PLATFORMS.COUPANG,
            this.PLATFORMS.GMARKET,
            this.PLATFORMS.AUCTION,
            this.PLATFORMS.ELEVENST
        ].includes(platformId);
    }

    /**
     * 플랫폼이 중국 플랫폼인지 확인
     * @param {string} platformId - 플랫폼 ID
     * @returns {boolean} 중국 플랫폼 여부
     */
    static isChinesePlatform(platformId) {
        return [
            this.PLATFORMS.ALIEXPRESS,
            this.PLATFORMS.CHINA_1688,
            this.PLATFORMS.TAOBAO
        ].includes(platformId);
    }
}

// Browser global export (V2.0)
if (typeof window !== 'undefined') {
    window.PlatformDetector = PlatformDetector;
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PlatformDetector;
}
