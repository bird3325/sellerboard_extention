/**
 * SellerBoard Content Bridge
 * 웹 애플리케이션(https://sellerboard.vercel.app)과 확장프로그램 간의 통신을 담당
 */

window.addEventListener('message', async (event) => {
    // 1. 보안 검사: 신뢰할 수 있는 소스 및 메시지 타입 확인
    // 개발 환경(localhost)과 배포 환경(vercel.app) 모두 허용
    const allowedOrigins = [
        'http://localhost:3000',
        'https://sellerboard.vercel.app'
    ];

    if (!allowedOrigins.some(origin => event.origin.startsWith(origin))) return;
    if (event.data.source !== 'SELLERBOARD_WEB') return;

    const { type, payload } = event.data;

    // 2. 메시지 처리
    if (type === 'PING') {
        // 연결 확인 (Handshake)
        window.postMessage({ type: 'PONG', source: 'SELLERBOARD_EXT' }, '*');
    }

    else if (type === 'SOURCING_REQ') {
        try {
            console.log('[SellerBoard Bridge] 소싱 요청 수신:', payload);

            // 3. Background Script로 실제 작업 위임 (CORS 회피 및 다중 탭 제어)
            const results = await chrome.runtime.sendMessage({
                action: 'EXECUTE_SOURCING',
                data: payload
            });

            // 4. 결과 반환
            window.postMessage({
                type: 'SOURCING_COMPLETE',
                source: 'SELLERBOARD_EXT',
                payload: results
            }, '*');
        } catch (err) {
            console.error('[SellerBoard Bridge] 소싱 요청 처리 중 오류:', err);

            let errorMessage = err.message || '알 수 없는 오류가 발생했습니다.';

            // 확장 프로그램이 재로딩되었을 때 발생하는 에러 처리
            if (errorMessage.includes('Extension context invalidated')) {
                errorMessage = '확장 프로그램이 업데이트되었습니다. 페이지를 새로고침해주세요.';
            }

            window.postMessage({
                type: 'SOURCING_ERROR',
                source: 'SELLERBOARD_EXT',
                error: errorMessage
            }, '*');
        }
    }

    else if (type === 'SYNC_SESSION') {
        try {
            console.log('[SellerBoard Bridge] 세션 동기화 요청 수신');

            // Background Script로 세션 전달
            const result = await chrome.runtime.sendMessage({
                action: 'SYNC_SESSION',
                sessionData: payload
            });

            window.postMessage({
                type: 'SYNC_SESSION_COMPLETE',
                source: 'SELLERBOARD_EXT',
                success: result.success
            }, '*');
        } catch (err) {
            console.error('[SellerBoard Bridge] 세션 동기화 오류:', err);
        }
    }
});
