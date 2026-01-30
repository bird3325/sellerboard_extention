/**
 * URL Utilities for SellerBoard Extension
 * URL 정규화 및 파라미터 처리
 */

export class UrlUtils {
    /**
     * URL 정규화 (불필요한 트래킹 파라미터 제거)
     * @param {string} url - 원본 URL
     * @returns {string} 정규화된 URL
     */
    static normalize(url) {
        if (!url) return '';

        try {
            const urlObj = new URL(url);

            // 1. 제거할 파라미터 목록 (트래킹, 분석용)
            const paramsToRemove = [
                'spm', 'scm', '_t', 'NaPm',             // 알리/타오바오/네이버 트래킹
                'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', // GA
                'wf_ingo', 'wf_cwb',                    // 11번가 등
                'bs_code',                              // 쿠팡 등
                'pvid', 'algo_exp_id', 'algo_pvid'      // 알리 알고리즘 파라미터
            ];

            // 2. 파라미터 필터링
            paramsToRemove.forEach(param => {
                urlObj.searchParams.delete(param);
            });

            // 3. 해시 제거 (선택적: 일부 SPA는 해시 사용하므로 주의 필요)
            // 대부분의 상페는 해시가 불필요하므로 제거
            urlObj.hash = '';

            // 4. 정렬 (일관성 보장)
            urlObj.searchParams.sort();

            return urlObj.toString();
        } catch (e) {
            // URL 파싱 실패 시 원본 반환 (혹은 쿼리 스트립)
            console.warn('[UrlUtils] Normalization failed:', e);
            return url.split('?')[0]; // Fallback to stripping query
        }
    }

    /**
     * 기본 URL 추출 (쿼리 스트링 완전 제거 - 탭 검색용)
     * @param {string} url 
     * @returns {string}
     */
    static getBaseUrl(url) {
        if (!url) return '';
        try {
            const urlObj = new URL(url);
            return `${urlObj.origin}${urlObj.pathname}`;
        } catch (e) {
            return url.split('?')[0];
        }
    }
}
