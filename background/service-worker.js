// ========================================
// StepFlow - Background Service Worker
// ========================================

// --- Side Panel: アイコンクリックで開く ---
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// --- Execution State ---
let executionState = null;

// --- Message Handler ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "RUN_WORKFLOW":
      handleRunWorkflow(message.workflow, sendResponse);
      return true; // async response

    case "STOP_WORKFLOW":
      handleStopWorkflow();
      sendResponse({ success: true });
      break;

    case "START_PICKER":
      handleStartPicker(sendResponse);
      return true; // async response

    case "PICKER_RESULT":
      // content scriptからの結果をpopupに転送
      notifyPopup({
        type: "PICKER_RESULT",
        selector: message.selector,
        selectorIndex: message.selectorIndex ?? null,
        selectOptions: message.selectOptions ?? null,
      });
      sendResponse({ success: true });
      break;

    case "CANCEL_PICKER":
      handleCancelPicker(sendResponse);
      return true; // async response

    case "START_OBSERVER":
      handleStartObserver(sendResponse);
      return true; // async response

    case "STOP_OBSERVER":
      handleStopObserver(sendResponse);
      return true; // async response

    case "OBSERVER_RESULT":
      // content scriptからの結果をサイドパネルに転送
      notifyPopup({ type: "OBSERVER_RESULT", elements: message.elements });
      sendResponse({ success: true });
      break;
  }
});

// --- Run Workflow ---
async function handleRunWorkflow(workflow, sendResponse) {
  if (executionState && executionState.running) {
    sendResponse({ error: "既に実行中です" });
    return;
  }

  executionState = {
    running: true,
    workflowId: workflow.id,
    currentStepIndex: 0,
    totalSteps: workflow.steps.length,
    copyResults: [],
    aborted: false,
  };

  sendResponse({ success: true });

  try {
    const tab = await getWebPageTab();
    if (!tab) {
      notifyPopup({
        type: "STEP_ERROR",
        stepIndex: 0,
        error: "Webページのタブが見つかりません",
      });
      finishExecution();
      return;
    }

    // Content scriptをインジェクト
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/content.js"],
    });

    // ステップを順次実行
    for (let i = 0; i < workflow.steps.length; i++) {
      if (executionState.aborted) break;

      executionState.currentStepIndex = i;
      notifyPopup({
        type: "STEP_PROGRESS",
        currentStep: i,
        totalSteps: workflow.steps.length,
      });

      const step = workflow.steps[i];

      try {
        const result = await executeStepOnTab(tab.id, step);

        if (step.type === "copy" && result && result.text) {
          executionState.copyResults.push({
            label: step.label || "",
            text: result.text,
          });
        }
      } catch (err) {
        notifyPopup({
          type: "STEP_ERROR",
          stepIndex: i,
          error: err.message || "ステップ実行エラー",
        });
        if (workflow.stopOnError) {
          executionState.aborted = true;
          break;
        }
      }

      // 次のステップとの間隔待機（最後のステップ以降は不要）
      // ステップ個別の間隔が設定されていればそちらを優先
      if (i < workflow.steps.length - 1 && !executionState.aborted) {
        const wait =
          step.interval != null ? step.interval : workflow.interval || 0;
        await delay(wait);
      }
    }

    // コピー結果をクリップボードに書き込み
    if (executionState.copyResults.length > 0 && !executionState.aborted) {
      const formattedText = formatCopyResults(executionState.copyResults);
      await writeToClipboard(tab.id, formattedText);
    }

    if (executionState.aborted) {
      // 停止時もコピー結果があればクリップボードに書き込み
      if (executionState.copyResults.length > 0) {
        const formattedText = formatCopyResults(executionState.copyResults);
        await writeToClipboard(tab.id, formattedText);
      }
      notifyPopup({
        type: "WORKFLOW_STOPPED",
        copyResults: executionState.copyResults,
      });
    } else {
      notifyPopup({
        type: "WORKFLOW_COMPLETE",
        copyResults: executionState.copyResults,
      });
    }
  } catch (err) {
    notifyPopup({
      type: "STEP_ERROR",
      stepIndex: executionState.currentStepIndex,
      error: err.message || "実行エラー",
    });
  }

  finishExecution();
}

// --- Stop Workflow ---
function handleStopWorkflow() {
  if (executionState) {
    executionState.aborted = true;
  }
}

// --- Execute Step on Tab ---
function executeStepOnTab(tabId, step) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: "EXECUTE_STEP", step },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response && response.success) {
          resolve(response.data || {});
        } else {
          reject(new Error(response ? response.error : "応答なし"));
        }
      },
    );
  });
}

// --- Clipboard ---
async function writeToClipboard(tabId, text) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (textToWrite) => {
        return navigator.clipboard.writeText(textToWrite);
      },
      args: [text],
    });
  } catch (err) {
    console.error("クリップボード書き込みエラー:", err);
  }
}

// --- Copy Result Formatting ---
function formatCopyResults(results) {
  const hasAnyLabel = results.some((r) => r.label);
  if (hasAnyLabel) {
    return results
      .map((r) => {
        const labelLine = r.label ? `■${r.label}` : "■";
        return `${labelLine}\n${r.text}`;
      })
      .join("\n");
  } else {
    return results.map((r) => r.text).join("\n");
  }
}

// --- Element Picker ---
async function handleStartPicker(sendResponse) {
  try {
    const tab = await getWebPageTab();
    if (!tab) {
      const msg =
        "Webページのタブが見つかりません。Webページを開いた状態で実行してください。";
      sendResponse({ success: false, error: msg });
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/picker.js"],
    });
    sendResponse({ success: true });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// --- Cancel Picker ---
async function handleCancelPicker(sendResponse) {
  try {
    const tab = await getWebPageTab();
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { type: "CANCEL_PICKER" });
    }
    sendResponse({ success: true });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// スクリプト注入不可のURLかどうか
function isRestrictedUrl(url) {
  return (
    !url || /^(chrome|chrome-extension|edge|about|devtools):\/\//.test(url)
  );
}

// アクティブなWebページタブを取得（chrome:// 等を除外）
async function getWebPageTab() {
  const tabs = await chrome.tabs.query({ currentWindow: true, active: true });
  // アクティブタブがWebページならそのまま使う
  if (tabs[0] && !isRestrictedUrl(tabs[0].url)) {
    return tabs[0];
  }
  // アクティブタブがchrome://等の場合、同じウィンドウのWebページタブを探す
  const allTabs = await chrome.tabs.query({ currentWindow: true });
  // 最後にアクセスされたWebページタブを返す
  return (
    allTabs
      .filter((t) => !isRestrictedUrl(t.url))
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || null
  );
}

// --- DOM Observer ---
async function handleStartObserver(sendResponse) {
  try {
    const tab = await getWebPageTab();
    if (!tab) {
      const msg =
        "Webページのタブが見つかりません。Webページを開いた状態で実行してください。";
      sendResponse({ success: false, error: msg });
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/observer.js"],
    });
    sendResponse({ success: true });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

async function handleStopObserver(sendResponse) {
  try {
    const tab = await getWebPageTab();
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { type: "STOP_OBSERVER" });
    }
    sendResponse({ success: true });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// --- Helpers ---
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function finishExecution() {
  executionState = null;
}

function notifyPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup may be closed — ignore
  });
}
