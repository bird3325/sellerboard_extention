/**
 * Sourcing Analyzer Utility for Sellerboard V2.2
 * 상품 데이터의 조건 스캔, 종합 점수 산정, 추천 사유 생성, 마진 계산 및 역검색 연동 로직을 담당합니다.
 */

export class SourcingAnalyzer {
    /**
     * 사용자가 설정한 조건에 따라 상품 목록을 스캔하고 조건에 부합하는 후보군만 반환합니다.
     * @param {Array} items - 상품 객체 배열
     * @param {Object} criteria - 스캔 필터 조건
     * @param {string} [criteria.category] - 대상 카테고리
     * @param {number} [criteria.minPrice] - 최소 가격 (KRW)
     * @param {number} [criteria.maxPrice] - 최대 가격 (KRW)
     * @param {number} [criteria.targetMargin] - 목표 마진율 (%)
     * @param {string} [criteria.riskTolerance] - 리스크 허용 수준 ('low', 'medium', 'high')
     * @returns {Array} 필터링 및 분석이 끝난 후보군 배열
     */
    static filterCandidates(items, criteria = {}) {
        if (!Array.isArray(items)) return [];
        
        return items.map(item => {
            // 각 아이템에 대한 분석 점수 및 추천 사유 미리 계산
            const analysis = this.analyzeItem(item, criteria);
            return {
                ...item,
                analysis
            };
        }).filter(item => {
            const { analysis } = item;
            
            // 1. 카테고리 필터
            if (criteria.category && item.category) {
                if (!item.category.includes(criteria.category)) {
                    return false;
                }
            }
            
            // 2. 가격대 필터 (KRW 기준)
            const price = parseFloat(item.price) || 0;
            if (criteria.minPrice !== undefined && price < criteria.minPrice) return false;
            if (criteria.maxPrice !== undefined && price > criteria.maxPrice) return false;
            
            // 3. 목표 마진 필터
            if (criteria.targetMargin !== undefined && analysis.marginRate < criteria.targetMargin) {
                return false;
            }
            
            // 4. 리스크 수준에 따른 필터링 (평점 기준)
            if (criteria.riskTolerance) {
                const rating = parseFloat(item.rating) || 0;
                if (criteria.riskTolerance === 'low' && rating < 4.7) return false;
                if (criteria.riskTolerance === 'medium' && rating < 4.5) return false;
                if (criteria.riskTolerance === 'high' && rating < 4.0) return false;
            }
            
            return true;
        });
    }

    /**
     * 개별 상품의 가치와 추천도를 다차원 분석합니다.
     * @param {Object} item - 상품 정보
     * @param {Object} criteria - 스캔 기준 조건
     * @returns {Object} { score, grade, marginRate, netProfit, reason }
     */
    static analyzeItem(item, criteria = {}) {
        const targetMargin = criteria.targetMargin || 25; // 기본 목표 마진율 25%
        
        // 1. 마진율 및 마진 시뮬레이션
        const price = parseFloat(item.price) || 0;
        // 임시 원가 추정 (중국 소싱 기준 통상 판매가의 35% ~ 50% 수준으로 원가 임시 책정 후 계산)
        const estimatedCost = item.cost || (price * 0.4); 
        const marginResult = this.calculateMargin(price, estimatedCost, {
            feeRate: 5.85, // 통상 스마트스토어/쿠팡 수수료 평균값
            shippingCost: 3000 // 기본 배송비 3,000원 적용
        });

        // 2. 종합 점수 산정 (100점 만점)
        const score = this.calculateScore(item, {
            marginRate: marginResult.marginRate,
            targetMargin: targetMargin
        });

        // 3. 추천 등급 산출
        let grade = 'C';
        if (score >= 90) grade = 'S';
        else if (score >= 80) grade = 'A';
        else if (score >= 70) grade = 'B';

        // 4. 한글 추천 사유 생성
        const reason = this.generateRecommendationReason(score, grade, item, marginResult, targetMargin);

        return {
            score,
            grade,
            marginRate: marginResult.marginRate,
            netProfit: marginResult.netProfit,
            reason
        };
    }

    /**
     * 마진 및 순수익을 시뮬레이션 계산합니다.
     * @param {number} sellingPrice - 판매가
     * @param {number} costPrice - 소싱 원가
     * @param {Object} [options] - 수수료 및 물류 정보
     * @param {number} [options.feeRate] - 플랫폼 수수료율 (%)
     * @param {number} [options.shippingCost] - 물류/배송 비용 (KRW)
     * @param {number} [options.extraCost] - 통관 등 기타 추가 비용 (KRW)
     * @returns {Object} { marginRate, netProfit }
     */
    static calculateMargin(sellingPrice, costPrice, options = {}) {
        const feeRate = options.feeRate || 0;
        const shippingCost = options.shippingCost || 0;
        const extraCost = options.extraCost || 0;

        const fee = (sellingPrice * (feeRate / 100));
        const totalExpense = costPrice + fee + shippingCost + extraCost;
        const netProfit = sellingPrice - totalExpense;
        const marginRate = sellingPrice > 0 ? (netProfit / sellingPrice) * 100 : 0;

        return {
            marginRate: Math.round(marginRate * 10) / 10,
            netProfit: Math.round(netProfit)
        };
    }

    /**
     * 세부 메트릭 가중치를 바탕으로 종합 추천 점수를 계산합니다.
     * @param {Object} item - 상품 객체
     * @param {Object} analysis - 분석 임시 데이터
     * @returns {number} 0~100점 사이의 점수
     */
    static calculateScore(item, analysis = {}) {
        let marginScore = 0;
        let ratingScore = 0;
        let popularityScore = 0;
        let stabilityScore = 20; // 리스크 안정성 기본 점수

        // 1. 마진 점수 (40점 만점)
        const marginRate = analysis.marginRate || 0;
        const targetMargin = analysis.targetMargin || 25;
        if (marginRate >= targetMargin) {
            marginScore = 40; // 목표 초과 달성 시 만점
        } else if (marginRate > 0) {
            marginScore = Math.round((marginRate / targetMargin) * 40);
        }

        // 2. 평점 점수 (20점 만점)
        const rating = parseFloat(item.rating) || 0;
        if (rating >= 4.8) ratingScore = 20;
        else if (rating >= 4.5) ratingScore = 17;
        else if (rating >= 4.0) ratingScore = 13;
        else if (rating > 0) ratingScore = 8;
        else ratingScore = 12; // 평점 정보 없는 경우 중간 평점 처리

        // 3. 인지도/리뷰 점수 (20점 만점)
        const reviewCount = parseInt(item.reviewCount || item.reviews) || 0;
        if (reviewCount >= 500) popularityScore = 20;
        else if (reviewCount >= 100) popularityScore = 17;
        else if (reviewCount >= 30) popularityScore = 13;
        else if (reviewCount > 0) popularityScore = 8;
        else popularityScore = 5;

        // 4. 플랫폼 리스크 점수 (20점 만점)
        // 국내 플랫폼(네이버, 쿠팡 등)은 안정성을 높게, 해외 소싱(알리, 타오바오 등)은 배송 리스크로 감점
        const platform = (item.platform || '').toLowerCase();
        if (platform === 'naver' || platform === 'coupang') {
            stabilityScore = 20;
        } else if (platform === 'aliexpress' || platform === 'taobao' || platform === '1688') {
            stabilityScore = 15; // 배송/교환 기간 고려
        }

        return Math.min(100, Math.max(0, marginScore + ratingScore + popularityScore + stabilityScore));
    }

    /**
     * 상품의 점수와 상태에 기초하여 명확하고 구체적인 한글 추천 근거를 작성합니다.
     */
    static generateRecommendationReason(score, grade, item, marginResult, targetMargin) {
        const platformKor = {
            naver: '네이버 스마트스토어',
            coupang: '쿠팡',
            aliexpress: '알리익스프레스',
            taobao: '타오바오',
            '1688': '1688'
        }[ (item.platform || '').toLowerCase() ] || item.platform || '소싱처';

        const marginRate = marginResult.marginRate;
        const reviewCount = parseInt(item.reviewCount || item.reviews) || 0;
        const rating = parseFloat(item.rating) || 0;

        if (grade === 'S') {
            return `[최우수 후보] ${platformKor}에서 수집된 특급 상품입니다. 마진율이 ${marginRate}%로 사용자 목표치(${targetMargin}%)를 크게 웃돌며, 평점 ${rating}점과 리뷰 ${reviewCount}건으로 검증된 대중적 시장성과 안정적인 품질을 동시에 확보하고 있어 최우선 순위로 소싱을 강력 추천합니다.`;
        } else if (grade === 'A') {
            return `[우수 후보] 우수한 기대 마진(${marginRate}%)을 제공하며 평점도 ${rating}점으로 매우 안정적입니다. 리뷰가 ${reviewCount}건 수준으로 시장 반응이 양호하므로, 소싱 시 경쟁력 확보가 손쉽게 가능할 것으로 분석됩니다.`;
        } else if (grade === 'B') {
            return `[대체 후보] 가격 및 마진율(${marginRate}%) 조건을 준수하지만, 리뷰 개수(${reviewCount}개)나 평점(${rating}점) 측면에서 추가적인 상세 페이지 검토 및 공급자 신인도 체크가 권장됩니다.`;
        } else {
            return `[검토 보류] 종합 평점 점수가 낮거나 소싱 예상 마진율(${marginRate}%)이 기대치에 미치지 못해 상대적으로 매력도가 떨어집니다. 유사 상품과의 가격비교를 통한 원가 절감 방안 조율이 필요합니다.`;
        }
    }

    /**
     * 이미지 URL을 전달받아 구글 렌즈 또는 1688 이미지 검색 연결 링크를 만듭니다.
     * @param {string} imageUrl - 상품 메인 이미지 주소
     * @param {string} [engine] - 'google' 또는 '1688'
     * @returns {string} 역검색 결과 사이트 URL
     */
    static generateReverseSearchUrl(imageUrl, engine = 'google') {
        if (!imageUrl) return '';
        const encodedUrl = encodeURIComponent(imageUrl);
        
        if (engine === '1688') {
            // 1688 이미지 업로드/검색 페이지 링크
            return `https://s.1688.com/youyuan/index.htm?tab=imageSearch&imgUrl=${encodedUrl}`;
        }
        
        // 구글 렌즈 기반 이미지 역검색 링크
        return `https://lens.google.com/uploadbyurl?url=${encodedUrl}`;
    }
}
