/**
 * IndexedDB 및 Chrome Storage를 활용한 데이터 관리
 */

class StorageManager {
  constructor() {
    this.dbName = 'SellerboardDB';
    this.dbVersion = 1;
    this.db = null;
  }

  /**
   * IndexedDB 초기화
   */
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Products 테이블
        if (!db.objectStoreNames.contains('products')) {
          const productsStore = db.createObjectStore('products', { 
            keyPath: 'id', 
            autoIncrement: true 
          });
          productsStore.createIndex('url', 'url', { unique: true });
          productsStore.createIndex('platform', 'platform', { unique: false });
          productsStore.createIndex('category', 'category', { unique: false });
          productsStore.createIndex('collectedAt', 'collectedAt', { unique: false });
          productsStore.createIndex('tags', 'tags', { unique: false, multiEntry: true });
        }

        // Profiles 테이블
        if (!db.objectStoreNames.contains('profiles')) {
          db.createObjectStore('profiles', { 
            keyPath: 'id', 
            autoIncrement: true 
          });
        }

        // History 테이블 (가격 변동 이력)
        if (!db.objectStoreNames.contains('history')) {
          const historyStore = db.createObjectStore('history', { 
            keyPath: 'id', 
            autoIncrement: true 
          });
          historyStore.createIndex('productId', 'productId', { unique: false });
          historyStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Schedules 테이블
        if (!db.objectStoreNames.contains('schedules')) {
          db.createObjectStore('schedules', { 
            keyPath: 'id', 
            autoIncrement: true 
          });
        }
      };
    });
  }

  /**
   * 상품 저장
   */
  async saveProduct(productData) {
    await this.ensureDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['products'], 'readwrite');
      const store = transaction.objectStore('products');
      
      // URL 중복 체크
      const urlIndex = store.index('url');
      const checkRequest = urlIndex.get(productData.url);
      
      checkRequest.onsuccess = () => {
        const existing = checkRequest.result;
        
        if (existing) {
          // 기존 상품 업데이트
          const updateData = { ...existing, ...productData, updatedAt: new Date().toISOString() };
          const updateRequest = store.put(updateData);
          
          updateRequest.onsuccess = () => {
            this.trackPriceChange(existing, productData);
            resolve({ updated: true, id: existing.id, data: updateData });
          };
          updateRequest.onerror = () => reject(updateRequest.error);
        } else {
          // 새 상품 추가
          const addData = { 
            ...productData, 
            collectedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          const addRequest = store.add(addData);
          
          addRequest.onsuccess = () => resolve({ 
            created: true, 
            id: addRequest.result, 
            data: addData 
          });
          addRequest.onerror = () => reject(addRequest.error);
        }
      };
      
      checkRequest.onerror = () => reject(checkRequest.error);
    });
  }

  /**
   * 상품 조회 (필터링 지원)
   */
  async getProducts(filters = {}) {
    await this.ensureDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['products'], 'readonly');
      const store = transaction.objectStore('products');
      const request = store.getAll();

      request.onsuccess = () => {
        let products = request.result;

        // 필터 적용
        if (filters.platform) {
          products = products.filter(p => p.platform === filters.platform);
        }
        if (filters.category) {
          products = products.filter(p => p.category === filters.category);
        }
        if (filters.tags) {
          products = products.filter(p => 
            filters.tags.some(tag => p.tags && p.tags.includes(tag))
          );
        }
        if (filters.minPrice) {
          products = products.filter(p => p.price >= filters.minPrice);
        }
        if (filters.maxPrice) {
          products = products.filter(p => p.price <= filters.maxPrice);
        }
        if (filters.search) {
          const searchLower = filters.search.toLowerCase();
          products = products.filter(p => 
            p.name?.toLowerCase().includes(searchLower) ||
            p.description?.toLowerCase().includes(searchLower)
          );
        }

        // 정렬
        if (filters.sortBy) {
          products.sort((a, b) => {
            const aVal = a[filters.sortBy];
            const bVal = b[filters.sortBy];
            const direction = filters.sortOrder === 'desc' ? -1 : 1;
            
            if (aVal < bVal) return -1 * direction;
            if (aVal > bVal) return 1 * direction;
            return 0;
          });
        }

        resolve(products);
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 상품 삭제
   */
  async deleteProduct(id) {
    await this.ensureDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['products'], 'readwrite');
      const store = transaction.objectStore('products');
      const request = store.delete(id);

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 가격 변동 추적
   */
  async trackPriceChange(oldProduct, newProduct) {
    if (oldProduct.price !== newProduct.price || 
        oldProduct.stock !== newProduct.stock) {
      
      await this.ensureDB();
      
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['history'], 'readwrite');
        const store = transaction.objectStore('history');
        
        const historyEntry = {
          productId: oldProduct.id,
          productName: oldProduct.name,
          oldPrice: oldProduct.price,
          newPrice: newProduct.price,
          oldStock: oldProduct.stock,
          newStock: newProduct.stock,
          timestamp: new Date().toISOString(),
          changeType: this.getChangeType(oldProduct, newProduct)
        };

        const request = store.add(historyEntry);
        request.onsuccess = () => resolve(historyEntry);
        request.onerror = () => reject(request.error);
      });
    }
  }

  /**
   * 변동 유형 판단
   */
  getChangeType(oldProduct, newProduct) {
    const types = [];
    if (oldProduct.price > newProduct.price) types.push('price_down');
    if (oldProduct.price < newProduct.price) types.push('price_up');
    if (oldProduct.stock !== newProduct.stock) types.push('stock_change');
    return types;
  }

  /**
   * 프로필 저장
   */
  async saveProfile(profileData) {
    await this.ensureDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['profiles'], 'readwrite');
      const store = transaction.objectStore('profiles');
      
      const data = profileData.id 
        ? profileData 
        : { ...profileData, createdAt: new Date().toISOString() };
      
      const request = profileData.id ? store.put(data) : store.add(data);

      request.onsuccess = () => resolve({ id: request.result, data });
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 프로필 조회
   */
  async getProfiles() {
    await this.ensureDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['profiles'], 'readonly');
      const store = transaction.objectStore('profiles');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 스케줄 저장
   */
  async saveSchedule(scheduleData) {
    await this.ensureDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['schedules'], 'readwrite');
      const store = transaction.objectStore('schedules');
      
      const data = scheduleData.id 
        ? scheduleData 
        : { ...scheduleData, createdAt: new Date().toISOString() };
      
      const request = scheduleData.id ? store.put(data) : store.add(data);

      request.onsuccess = () => resolve({ id: request.result, data });
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * DB 초기화 확인
   */
  async ensureDB() {
    if (!this.db) {
      await this.init();
    }
  }

  /**
   * Chrome Storage에 설정 저장
   */
  async saveSetting(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, () => {
        resolve(true);
      });
    });
  }

  /**
   * Chrome Storage에서 설정 가져오기
   */
  async getSetting(key, defaultValue = null) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key] !== undefined ? result[key] : defaultValue);
      });
    });
  }
}

// 싱글톤 인스턴스
const storageManager = new StorageManager();
