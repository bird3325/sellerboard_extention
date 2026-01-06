/**
 * Supabase 클라이언트
 * 상품 데이터를 Supabase DB에 저장
 */

// TODO: 아래 정보를 본인의 Supabase 프로젝트 정보로 변경하세요.
const SUPABASE_URL = 'https://ukjrsqthaibsvvycwduu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVranJzcXRoYWlic3Z2eWN3ZHV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQxMjkzODYsImV4cCI6MjA3OTcwNTM4Nn0.CnJ0TjBBp5iGk5uaBk7M6S5b0HrLhLxKA7RKG0jCYk4';

export class SupabaseClient {
    constructor() {
        this.supabaseUrl = SUPABASE_URL;
        this.supabaseKey = SUPABASE_KEY;
        this.session = null;
    }

    /**
     * 초기화 및 세션 복구
     */
    async initialize() {
        // 저장된 세션 확인
        const result = await chrome.storage.local.get(['supabaseSession']);
        if (result.supabaseSession) {
            this.session = result.supabaseSession;

        }
        return true;
    }

    /**
     * 로그인 (Email/Password)
     */
    async signIn(email, password) {
        try {
            // 1. Auth 로그인
            const response = await fetch(`${this.supabaseUrl}/auth/v1/token?grant_type=password`, {
                method: 'POST',
                headers: {
                    'apikey': this.supabaseKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email,
                    password
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error_description || data.msg || '로그인 실패');
            }

            // 2. 프로필 조회 및 승인 여부 확인
            const profileResponse = await fetch(`${this.supabaseUrl}/rest/v1/profiles?id=eq.${data.user.id}&select=*`, {
                method: 'GET',
                headers: {
                    'apikey': this.supabaseKey,
                    'Authorization': `Bearer ${data.access_token}`
                }
            });

            if (!profileResponse.ok) {
                throw new Error('프로필 정보를 가져올 수 없습니다.');
            }

            const profiles = await profileResponse.json();
            const profile = profiles[0];

            if (!profile) {
                throw new Error('프로필이 존재하지 않습니다.');
            }

            // 승인 대기 확인 (level이 0이면 미승인)
            if (profile.level === 0) {
                throw new Error('관리자 승인 대기 중입니다. 승인 후 이용해주세요.');
            }

            // 세션 및 프로필 저장
            this.session = { ...data, profile };
            await chrome.storage.local.set({ supabaseSession: this.session });


            return { success: true, user: data.user, profile };
        } catch (error) {
            console.error('[SupabaseClient] 로그인 오류:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 로그아웃
     */
    async signOut() {
        this.session = null;
        await chrome.storage.local.remove(['supabaseSession']);

        return { success: true };
    }

    /**
     * 현재 세션 가져오기
     */
    getSession() {
        return this.session;
    }

    /**
     * 세션 유효성 검사 및 자동 갱신
     */
    async validateSession() {
        if (!this.session || !this.session.access_token) return false;

        try {
            // 1. 현재 토큰으로 유저 정보 확인
            const response = await fetch(`${this.supabaseUrl}/auth/v1/user`, {
                method: 'GET',
                headers: {
                    'apikey': this.supabaseKey,
                    'Authorization': `Bearer ${this.session.access_token}`
                }
            });

            if (response.ok) {
                return true;
            }

            // 2. 토큰 만료 시 리프레시 토큰으로 갱신 시도

            const refreshResult = await this.refreshSession();
            return refreshResult.success;

        } catch (error) {
            console.error('[SupabaseClient] 세션 검증 실패:', error);
            return false;
        }
    }

    /**
     * 토큰 갱신 (Refresh Token)
     */
    async refreshSession() {
        if (!this.session || !this.session.refresh_token) {
            return { success: false };
        }

        try {
            const response = await fetch(`${this.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
                method: 'POST',
                headers: {
                    'apikey': this.supabaseKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    refresh_token: this.session.refresh_token
                })
            });

            const data = await response.json();

            if (!response.ok) {
                console.error('[SupabaseClient] 토큰 갱신 실패:', data.error_description || data.msg);
                await this.signOut(); // 갱신 실패 시 로그아웃
                return { success: false };
            }

            // 새로운 세션 정보 저장 (프로필은 유지)
            this.session = {
                ...data,
                profile: this.session.profile
            };
            await chrome.storage.local.set({ supabaseSession: this.session });


            return { success: true };
        } catch (error) {
            console.error('[SupabaseClient] 토큰 갱신 오류:', error);
            return { success: false };
        }
    }

    /**
     * 연결 테스트 (Health Check)
     */
    async testConnection() {
        try {
            const response = await fetch(`${this.supabaseUrl}/rest/v1/`, {
                method: 'GET',
                headers: {
                    'apikey': this.supabaseKey,
                    'Authorization': `Bearer ${this.supabaseKey}`
                }
            });

            if (response.ok) {
                return { success: true };
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * 상품 저장
     * @param {Object} product - 상품 데이터
     */
    /**
     * 상품 저장
     * @param {Object} product - 상품 데이터
     */
    async saveProduct(product) {
        if (!this.session) {
            throw new Error('로그인이 필요합니다.');
        }

        /* 전송 한도 체크 제거
        if (this.session.profile.transmission_limit <= 0) {
            throw new Error('전송 한도가 초과되었습니다. 관리자에게 문의하세요.');
        }
        */

        try {
            // [최종 가드] 플랫폼 활성 상태 확인
            const platformStatus = await this.checkPlatformActive(product.platform);
            if (!platformStatus || !platformStatus.isActive) {
                const reason = !platformStatus || !platformStatus.isListed ?
                    '등록되지 않은 플랫폼입니다.' : '현재 비활성화된 플랫폼입니다.';
                throw new Error(`[수집 불가] ${reason} 관리자에게 문의해주세요. (플랫폼: ${product.platform})`);
            }

            const response = await fetch(`${this.supabaseUrl}/rest/v1/products`, {
                method: 'POST',
                headers: {
                    'apikey': this.supabaseKey,
                    'Authorization': `Bearer ${this.session.access_token}`, // 유저 토큰 사용
                    'Content-Type': 'application/json',
                    'Prefer': 'return=representation' // ID를 가져오기 위해 representation 사용
                },
                body: JSON.stringify({
                    user_id: this.session.user.id, // 필수: 사용자 ID

                    // Basic Info
                    name: product.name,
                    original_name: product.original_name || product.name,
                    category: product.category,
                    platform: product.platform,
                    status: 'draft',

                    // Price Info
                    price: product.price,
                    cost: 0,
                    collected_price: product.price,
                    stock: typeof product.stock === 'number' ? product.stock : 0,

                    // Sourcing Info
                    sourcing_url: product.url,

                    // Media & Details
                    image_url: product.images && product.images.length > 0 ? product.images[0] : null,
                    images: product.images || [],
                    video_url: product.videos && product.videos.length > 0 ? product.videos[0] : null,
                    videos: product.videos || [],
                    description: product.description?.html || product.description?.text || '',

                    // Structured Data
                    options: product.options || [],
                    specs: product.specs || {},
                    shipping: product.shipping || {}, // Added shipping data

                    // Timestamps
                    collected_at: product.collectedAt || new Date().toISOString(),

                    // Logs
                    transmission_log: {}
                })
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`저장 실패: ${error}`);
            }

            const insertedData = await response.json();
            const productId = insertedData && insertedData.length > 0 ? insertedData[0].id : null;

            // 전송 한도 차감 제거
            // await this.decrementLimit();

            // 수집 로그 저장 (성공)
            await this.saveCollectionLog({
                product_id: productId,
                product_name: product.name,
                platform: product.platform,
                sourcing_url: product.url,
                status: 'success',
                collection_type: product.collection_type || 'single'
            });


            return { success: true, product_id: productId };
        } catch (error) {
            console.error('[SupabaseClient] 상품 저장 오류:', error);

            // 수집 로그 저장 (실패)
            await this.saveCollectionLog({
                product_name: product.name,
                platform: product.platform,
                sourcing_url: product.url || '',
                status: 'fail', // 'fail'로 고정 (CHECK 제약 조건 대응)
                collection_type: product.collection_type || 'single',
                error_message: error.message
            });

            throw error;
        }
    }

    /**
     * 수집 로그 저장
     * @param {Object} logData - 로그 데이터
     */
    async saveCollectionLog(logData) {
        if (!this.session) return;

        try {


            const response = await fetch(`${this.supabaseUrl}/rest/v1/collection_logs`, {
                method: 'POST',
                headers: {
                    'apikey': this.supabaseKey,
                    'Authorization': `Bearer ${this.session.access_token}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify({
                    user_id: this.session.user.id,
                    product_id: logData.product_id || null,
                    product_name: logData.product_name,
                    platform: logData.platform,
                    sourcing_url: logData.sourcing_url,
                    status: logData.status === 'fail' ? 'fail' : 'success', // CHECK 제약 조건: success, fail
                    collection_type: logData.collection_type || 'single',
                    error_message: logData.error_message || null
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('[SupabaseClient] 수집 로그 저장 실패 (HTTP ' + response.status + '):', errorText);
            } else {

            }
        } catch (error) {
            console.error('[SupabaseClient] 수집 로그 저장 네트워크 오류:', error);
        }
    }

    /**
     * 전송 한도 차감
     */
    async decrementLimit() {
        if (!this.session || !this.session.profile) return;

        try {
            const newLimit = this.session.profile.transmission_limit - 1;

            const response = await fetch(`${this.supabaseUrl}/rest/v1/profiles?id=eq.${this.session.user.id}`, {
                method: 'PATCH',
                headers: {
                    'apikey': this.supabaseKey,
                    'Authorization': `Bearer ${this.session.access_token}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=representation'
                },
                body: JSON.stringify({
                    transmission_limit: newLimit
                })
            });

            if (response.ok) {
                const data = await response.json();
                if (data && data.length > 0) {
                    // 세션 업데이트
                    this.session.profile = data[0];
                    await chrome.storage.local.set({ supabaseSession: this.session });

                }
            }
        } catch (error) {
            console.error('[SupabaseClient] 전송 한도 차감 실패:', error);
        }
    }

    /**
     * URL로 중복 상품 체크
     * @param {string} url - 확인할 상품 URL
     * @returns {Promise<Object>} { isDuplicate: boolean, product: Object | null }
     */
    async checkDuplicateByUrl(url) {
        if (!this.session) {
            return { isDuplicate: false, product: null };
        }

        try {
            const response = await fetch(
                `${this.supabaseUrl}/rest/v1/products?sourcing_url=eq.${encodeURIComponent(url)}&select=id,name,collected_at,price,collected_price`,
                {
                    method: 'GET',
                    headers: {
                        'apikey': this.supabaseKey,
                        'Authorization': `Bearer ${this.session.access_token}`
                    }
                }
            );

            if (!response.ok) {
                throw new Error(`중복 체크 실패: ${response.status}`);
            }

            const products = await response.json();

            if (products && products.length > 0) {

                return {
                    isDuplicate: true,
                    product: products[0]
                };
            }

            return { isDuplicate: false, product: null };
        } catch (error) {
            console.error('[SupabaseClient] 중복 체크 오류:', error);
            return { isDuplicate: false, product: null };
        }
    }

    /**
     * 통계 조회
     */
    async getStats() {
        if (!this.session) {
            return { total: 0, today: 0, remaining: 0 };
        }

        try {
            // 전체 개수
            const totalResponse = await fetch(
                `${this.supabaseUrl}/rest/v1/products?select=count`,
                {
                    method: 'HEAD',
                    headers: {
                        'apikey': this.supabaseKey,
                        'Authorization': `Bearer ${this.session.access_token}`,
                        'Prefer': 'count=exact'
                    }
                }
            );

            const total = parseInt(totalResponse.headers.get('content-range')?.split('/')[1] || '0');

            // 오늘 수집한 개수
            const today = new Date().toISOString().split('T')[0];
            const todayResponse = await fetch(
                `${this.supabaseUrl}/rest/v1/products?select=count&collected_at=gte.${today}T00:00:00`,
                {
                    method: 'HEAD',
                    headers: {
                        'apikey': this.supabaseKey,
                        'Authorization': `Bearer ${this.session.access_token}`,
                        'Prefer': 'count=exact'
                    }
                }
            );

            const todayCount = parseInt(todayResponse.headers.get('content-range')?.split('/')[1] || '0');

            // 최신 프로필 정보 가져오기 (잔여 건수 확인용)
            await this.refreshProfile();

            return {
                total,
                today: todayCount,
                remaining: this.session.profile.transmission_limit
            };
        } catch (error) {
            console.error('[SupabaseClient] 통계 조회 오류:', error);
            return { total: 0, today: 0, remaining: 0 };
        }
    }

    /**
     * 프로필 정보 갱신
     */
    async refreshProfile() {
        if (!this.session) return;

        try {
            const response = await fetch(`${this.supabaseUrl}/rest/v1/profiles?id=eq.${this.session.user.id}&select=*`, {
                method: 'GET',
                headers: {
                    'apikey': this.supabaseKey,
                    'Authorization': `Bearer ${this.session.access_token}`
                }
            });

            if (response.ok) {
                const profiles = await response.json();
                if (profiles && profiles.length > 0) {
                    this.session.profile = profiles[0];
                    await chrome.storage.local.set({ supabaseSession: this.session });
                }
            }
        } catch (error) {
            console.error('[SupabaseClient] 프로필 갱신 실패:', error);
        }
    }

    /**
     * 플랫폼 활성 상태 확인
     * @param {string} platformId - 확인할 플랫폼 ID
     * @returns {Promise<Object>} { isActive: boolean, isListed: boolean }
     */
    async checkPlatformActive(platformId) {
        if (!this.session) {
            return { isActive: false, isListed: false };
        }

        // 플랫폼 ID가 없는 경우 보수적으로 처리
        if (!platformId || platformId === 'generic') {
            return { isActive: false, isListed: false };
        }

        try {
            // ilike를 사용하여 대소문자 구분 없이 매칭 (예: aliexpress, AliExpress 모두 대응)
            const response = await fetch(
                `${this.supabaseUrl}/rest/v1/sourcing_platform_settings?platform_id=ilike.${encodeURIComponent(platformId)}&select=is_active`,
                {
                    method: 'GET',
                    headers: {
                        'apikey': this.supabaseKey,
                        'Authorization': `Bearer ${this.session.access_token}`
                    }
                }
            );

            if (!response.ok) {
                return { isActive: false, isListed: false };
            }

            const settings = await response.json();

            if (settings && settings.length > 0) {
                return {
                    isActive: settings[0].is_active === true,
                    isListed: true
                };
            }

            return { isActive: false, isListed: false };
        } catch (error) {
            console.error('[SupabaseClient] 플랫폼 상태 체크 오류:', error);
            return { isActive: false, isListed: false };
        }
    }
}

// 싱글톤 인스턴스
export const supabaseClient = new SupabaseClient();
