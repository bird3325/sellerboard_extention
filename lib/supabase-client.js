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
            console.log('[SupabaseClient] 세션 복구 완료');
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

            console.log('[SupabaseClient] 로그인 성공:', profile.email);
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
        console.log('[SupabaseClient] 로그아웃 완료');
        return { success: true };
    }

    /**
     * 현재 세션 가져오기
     */
    getSession() {
        return this.session;
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
    async saveProduct(product) {
        if (!this.session) {
            throw new Error('로그인이 필요합니다.');
        }

        try {
            const response = await fetch(`${this.supabaseUrl}/rest/v1/products`, {
                method: 'POST',
                headers: {
                    'apikey': this.supabaseKey,
                    'Authorization': `Bearer ${this.session.access_token}`, // 유저 토큰 사용
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
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
                    description: product.description?.html || product.description?.text || '',

                    // Structured Data
                    options: product.options || [],
                    specs: product.specs || {},

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

            console.log('[SupabaseClient] 상품 저장 성공:', product.name);
            return { success: true };
        } catch (error) {
            console.error('[SupabaseClient] 상품 저장 오류:', error);
            throw error;
        }
    }

    /**
     * 통계 조회
     */
    async getStats() {
        if (!this.session) {
            return { total: 0, today: 0 };
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

            return {
                total,
                today: todayCount
            };
        } catch (error) {
            console.error('[SupabaseClient] 통계 조회 오류:', error);
            return { total: 0, today: 0 };
        }
    }
}

// 싱글톤 인스턴스
export const supabaseClient = new SupabaseClient();
