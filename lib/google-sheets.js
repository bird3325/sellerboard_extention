/**
 * Google Sheets API 연동 유틸리티
 */

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * 구글 시트에 데이터 추가
 * @param {string} spreadsheetId - 스프레드시트 ID
 * @param {string} sheetName - 시트 이름
 * @param {Array} data - 추가할 데이터 (배열의 배열)
 * @param {string} authToken - OAuth 인증 토큰
 */
async function appendToSheet(spreadsheetId, sheetName, data, authToken) {
    const range = `${sheetName}!A:Z`;
    const url = `${SHEETS_API_BASE}/${spreadsheetId}/values/${range}:append?valueInputOption=RAW`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                values: data
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || '구글 시트 저장 실패');
        }

        return await response.json();
    } catch (error) {
        console.error('구글 시트 저장 오류:', error);
        throw error;
    }
}

/**
 * 상품 데이터를 구글 시트 형식으로 변환
 * @param {Object} product - 상품 데이터
 * @returns {Array} - 시트에 추가할 행 데이터
 */
function productToSheetRow(product) {
    return [
        new Date().toISOString(),
        product.name || '',
        product.price || '',
        product.originalPrice || '',
        product.platform || '',
        product.url || '',
        product.imageUrl || '',
        product.description || '',
        JSON.stringify(product.options || []),
        JSON.stringify(product.detailImages || [])
    ];
}

/**
 * 시트에 헤더 추가 (최초 1회)
 * @param {string} spreadsheetId - 스프레드시트 ID
 * @param {string} sheetName - 시트 이름
 * @param {string} authToken - OAuth 인증 토큰
 */
async function createSheetHeader(spreadsheetId, sheetName, authToken) {
    const headers = [
        [
            '수집일시',
            '상품명',
            '가격',
            '원가',
            '플랫폼',
            'URL',
            '이미지URL',
            '설명',
            '옵션',
            '상세이미지'
        ]
    ];

    return await appendToSheet(spreadsheetId, sheetName, headers, authToken);
}

/**
 * 시트가 비어있는지 확인
 * @param {string} spreadsheetId - 스프레드시트 ID
 * @param {string} sheetName - 시트 이름
 * @param {string} authToken - OAuth 인증 토큰
 */
async function isSheetEmpty(spreadsheetId, sheetName, authToken) {
    const range = `${sheetName}!A1:A1`;
    const url = `${SHEETS_API_BASE}/${spreadsheetId}/values/${range}`;

    try {
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (!response.ok) {
            return true;
        }

        const data = await response.json();
        return !data.values || data.values.length === 0;
    } catch (error) {
        console.error('시트 확인 오류:', error);
        return true;
    }
}

/**
 * 상품을 구글 시트에 저장
 * @param {Object} product - 상품 데이터
 * @param {Object} sheetConfig - 시트 설정 (spreadsheetId, sheetName, authToken)
 */
async function saveProductToSheet(product, sheetConfig) {
    const { spreadsheetId, sheetName, authToken } = sheetConfig;

    // 시트가 비어있으면 헤더 추가
    const isEmpty = await isSheetEmpty(spreadsheetId, sheetName, authToken);
    if (isEmpty) {
        await createSheetHeader(spreadsheetId, sheetName, authToken);
    }

    // 상품 데이터 추가
    const row = productToSheetRow(product);
    return await appendToSheet(spreadsheetId, sheetName, [row], authToken);
}

/**
 * 여러 상품을 한번에 구글 시트에 저장
 * @param {Array} products - 상품 데이터 배열
 * @param {Object} sheetConfig - 시트 설정
 */
async function saveProductsToSheet(products, sheetConfig) {
    const { spreadsheetId, sheetName, authToken } = sheetConfig;

    // 시트가 비어있으면 헤더 추가
    const isEmpty = await isSheetEmpty(spreadsheetId, sheetName, authToken);
    if (isEmpty) {
        await createSheetHeader(spreadsheetId, sheetName, authToken);
    }

    // 모든 상품 데이터 변환
    const rows = products.map(productToSheetRow);
    return await appendToSheet(spreadsheetId, sheetName, rows, authToken);
}

/**
 * 토큰 갱신
 * @param {string} oldToken - 기존 토큰
 */
async function refreshAuthToken(oldToken) {
    return new Promise((resolve, reject) => {
        chrome.identity.removeCachedAuthToken({ token: oldToken }, () => {
            chrome.identity.getAuthToken({ interactive: true }, (token) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(token);
                }
            });
        });
    });
}
