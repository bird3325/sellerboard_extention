/**
 * Progress Window - Batch Collection Progress Tracking
 */

console.log('[Progress] Progress window loaded');

// DOM Elements
const progressBarFill = document.getElementById('progress-bar-fill');
const progressPercentage = document.getElementById('progress-percentage');
const progressCount = document.getElementById('progress-count');
const progressMessage = document.getElementById('progress-message');
const currentTabName = document.getElementById('current-tab-name');
const cancelBtn = document.getElementById('cancel-btn');

const progressCard = document.querySelector('.progress-card');
const completionCard = document.getElementById('completion-card');
const resultTotal = document.getElementById('result-total');
const resultSuccess = document.getElementById('result-success');
const resultFailed = document.getElementById('result-failed');

// State
let cancelled = false;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    console.log('[Progress] DOM loaded');

    // Set up cancel button
    cancelBtn.addEventListener('click', () => {
        console.log('[Progress] Cancel clicked');
        cancelled = true;
        window.close();
    });

    // Listen for progress updates from service worker
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log('[Progress] Message received:', message);

        if (message.action === 'batchProgress') {
            updateProgress(message.data);
        } else if (message.action === 'batchComplete') {
            showCompletion(message.results);
        }
    });
});

/**
 * Update progress display
 */
function updateProgress(data) {
    const { current, total, percentage, currentTab } = data;

    console.log(`[Progress] Updating: ${current}/${total} (${percentage}%)`);

    // Update progress bar
    progressBarFill.style.width = `${percentage}%`;

    // Update percentage text
    progressPercentage.textContent = `${percentage}%`;

    // Update count
    progressCount.textContent = `${current}/${total}`;

    // Update current tab name
    if (currentTab) {
        currentTabName.textContent = currentTab;
    }

    // Update message
    if (current > 0) {
        progressMessage.textContent = `${current}개 항목 처리 중...`;
    }
}

/**
 * Show completion screen
 */
function showCompletion(results) {
    console.log('[Progress] Showing completion:', results);

    // Update completion stats
    resultTotal.textContent = results.total || 0;
    resultSuccess.textContent = results.success || 0;
    resultFailed.textContent = results.failed || 0;

    // Hide progress card, show completion card
    progressCard.style.display = 'none';
    completionCard.style.display = 'flex';

    // Auto close after 3 seconds
    setTimeout(() => {
        console.log('[Progress] Auto closing');
        window.close();
    }, 3000);
}

/**
 * Check if cancelled
 */
function isCancelled() {
    return cancelled;
}

console.log('[Progress] Script initialized');
