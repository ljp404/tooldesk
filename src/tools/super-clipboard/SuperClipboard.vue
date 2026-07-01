<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ToolPanel from '../../components/toolbox/ToolPanel.vue';
import AppIcon from '../../components/ui/AppIcon.vue';
import JsonCodeViewer from '../../components/ui/JsonCodeViewer.vue';
import { useClipboardCopy } from '../../composables/useClipboardCopy';
import { isJson } from '../../shared/toolContentRules';
import { extractJsonFromText } from '../../utils/jsonExtract';
import { formatJsonWithInlineValues } from '../../utils/jsonFormatter';
import {
  CATEGORY_LABELS,
  SUPER_CLIPBOARD_CATEGORIES,
  type SuperClipboardCategoryFilter,
  type SuperClipboardEntryDetail,
  type SuperClipboardEntryMeta,
  type SuperClipboardStats
} from '../../types/superClipboard';
import {
  clearSuperClipboard,
  copySuperClipboardItem,
  deleteSuperClipboardItem,
  getSuperClipboardDetail,
  getSuperClipboardStats,
  isSuperClipboardSupported,
  onSuperClipboardNewEntry,
  onSuperClipboardStatsChanged,
  querySuperClipboard
} from '../../utils/superClipboardClient';

const clipboardIcon = new URL('./assets/icon.svg', import.meta.url).href;

const supported = isSuperClipboardSupported();
const activeCategory = ref<SuperClipboardCategoryFilter>('all');
const searchText = ref('');
const items = ref<SuperClipboardEntryMeta[]>([]);
const total = ref(0);
const stats = ref<SuperClipboardStats | null>(null);
const selectedId = ref('');
const detail = ref<SuperClipboardEntryDetail | null>(null);
const loading = ref(false);
const statusMessage = ref('');
const imagePreviewOpen = ref(false);
const detailCache = ref<Record<string, SuperClipboardEntryDetail>>({});
const { copyStatus, copyText, clearCopyStatus } = useClipboardCopy();

let stopNewEntryListener: (() => void) | undefined;
let stopStatsListener: (() => void) | undefined;
let searchDebounceTimer: number | undefined;

const detailJsonDisplay = computed(() => {
  const text = detail.value?.text;

  if (!text?.trim() || !isJson(text)) {
    return null;
  }

  try {
    const jsonText = extractJsonFromText(text) ?? text.trim();
    return formatJsonWithInlineValues(jsonText, 4);
  } catch {
    return null;
  }
});

const categoryCounts = computed(() => {
  const by = stats.value?.byCategory;

  if (!by) {
    return {} as Record<SuperClipboardCategoryFilter, number>;
  }

  const all =
    by.text + by.link + by.json + by.code + by.path + by.html + by.image;

  return {
    all,
    code: by.code,
    html: by.html,
    image: by.image,
    json: by.json,
    link: by.link,
    path: by.path,
    text: by.text
  } as Record<SuperClipboardCategoryFilter, number>;
});

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}

function formatStorageSize(bytes?: number) {
  const value = Math.max(0, bytes ?? 0);

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  if (value < 1024 * 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function setStatus(message: string) {
  statusMessage.value = message;
}

function clearTransientFeedback() {
  statusMessage.value = '';
  clearCopyStatus();
}

async function loadList() {
  if (!supported) {
    return;
  }

  loading.value = true;

  try {
    const result = await querySuperClipboard({
      category: activeCategory.value,
      limit: 80,
      offset: 0,
      search: searchText.value
    });
    items.value = result.items;
    total.value = result.total;

    if (selectedId.value && !result.items.some((item) => item.id === selectedId.value)) {
      selectedId.value = '';
      detail.value = null;
    }
  } catch (error) {
    items.value = [];
    total.value = 0;
    setStatus(error instanceof Error ? error.message : '读取剪贴板记录失败');
  } finally {
    loading.value = false;
  }
}

async function loadStats() {
  try {
    stats.value = await getSuperClipboardStats();
  } catch (error) {
    stats.value = null;
    setStatus(error instanceof Error ? error.message : '读取剪贴板状态失败');
  }
}

async function loadDetail(id: string) {
  if (!id) {
    detail.value = null;
    return;
  }

  const cached = detailCache.value[id];

  if (cached) {
    detail.value = cached;
  }

  const nextDetail = await getSuperClipboardDetail(id);

  if (!nextDetail || selectedId.value !== id) {
    return;
  }

  detailCache.value = {
    ...detailCache.value,
    [id]: nextDetail
  };

  detail.value = nextDetail;
}

function selectItem(item: SuperClipboardEntryMeta) {
  const { id } = item;

  if (selectedId.value !== id) {
    clearTransientFeedback();
  }

  selectedId.value = id;
  imagePreviewOpen.value = false;

  const cachedDetail = detailCache.value[id];

  if (cachedDetail) {
    detail.value = cachedDetail;
    return;
  }

  if (item.type === 'image' && item.thumbnailDataUrl) {
    detail.value = {
      ...item,
      imagePreviewDataUrl: item.thumbnailDataUrl
    };
    return;
  }

  detail.value = item;
}

async function handleCopy(item?: SuperClipboardEntryMeta) {
  const id = item?.id ?? selectedId.value;

  if (!id) {
    return;
  }

  const copied = await copySuperClipboardItem(id);

  if (copied) {
    setStatus('已复制到系统剪贴板');
    return;
  }

  if (detail.value?.text) {
    await copyText(detail.value.text, '复制失败');
  }
}

async function handleDelete(item?: SuperClipboardEntryMeta) {
  const id = item?.id ?? selectedId.value;

  if (!id) {
    return;
  }

  const deleted = await deleteSuperClipboardItem(id);

  if (deleted) {
    setStatus('已删除');
    await loadList();
    await loadStats();
  }
}

async function handleClearCategory() {
  const label = SUPER_CLIPBOARD_CATEGORIES.find((item) => item.key === activeCategory.value)?.label ?? '全部';
  const confirmed = window.confirm(`确定清空「${label}」分类下的记录吗？`);

  if (!confirmed) {
    return;
  }

  const count = await clearSuperClipboard(activeCategory.value === 'all' ? 'all' : activeCategory.value);
  setStatus(`已清空 ${count} 条记录`);
  selectedId.value = '';
  detail.value = null;
  await loadList();
  await loadStats();
}

function scheduleSearch() {
  if (searchDebounceTimer) {
    window.clearTimeout(searchDebounceTimer);
  }

  searchDebounceTimer = window.setTimeout(() => {
    void loadList();
  }, 280);
}

watch(activeCategory, () => {
  void loadList();
});

onMounted(() => {
  if (!supported) {
    return;
  }

  void loadStats();
  void loadList();

  stopNewEntryListener = onSuperClipboardNewEntry((entry) => {
    if (activeCategory.value !== 'all' && activeCategory.value !== entry.category) {
      void loadStats();
      return;
    }

    if (searchText.value && !entry.preview.toLowerCase().includes(searchText.value.toLowerCase())) {
      void loadStats();
      return;
    }

    items.value = [entry, ...items.value.filter((item) => item.id !== entry.id)].slice(0, 80);
    total.value += 1;
    void loadStats();
    setStatus('已记录新的剪贴板内容');
  });

  stopStatsListener = onSuperClipboardStatsChanged((next) => {
    stats.value = next;
  });
});

onBeforeUnmount(() => {
  stopNewEntryListener?.();
  stopStatsListener?.();

  if (searchDebounceTimer) {
    window.clearTimeout(searchDebounceTimer);
  }
});

watch(selectedId, (id) => {
  imagePreviewOpen.value = false;
  void loadDetail(id);
});
</script>

<template>
  <ToolPanel fill>
    <div class="tool-content tool-fill-content super-clipboard">
      <header class="super-clipboard-head">
        <div>
          <h2>超级剪切板</h2>
          <p>
            <span v-if="stats?.enabled" class="super-clipboard-badge on">监听中</span>
            <span v-else-if="stats" class="super-clipboard-badge off">已暂停</span>
            <span v-else class="super-clipboard-badge off">状态未知</span>
            <span>共 {{ stats?.total ?? 0 }} 条</span>
            <span>占用 {{ formatStorageSize(stats?.storageBytes) }}</span>
            <span>本地 AES 加密存储</span>
          </p>
        </div>
        <div class="super-clipboard-head-actions">
          <button class="secondary-action" type="button" :disabled="!supported || loading" @click="loadList">刷新</button>
          <button class="secondary-action" type="button" :disabled="!supported || total === 0" @click="handleClearCategory">
            清空当前分类
          </button>
        </div>
      </header>

      <p v-if="!supported" class="super-clipboard-warning">请在 tooldesk 桌面客户端中使用超级剪切板。</p>

      <div class="super-clipboard-board">
        <aside class="super-clipboard-categories" aria-label="分类">
          <button
            v-for="category in SUPER_CLIPBOARD_CATEGORIES"
            :key="category.key"
            type="button"
            class="super-clipboard-category"
            :class="{ active: activeCategory === category.key }"
            @click="activeCategory = category.key"
          >
            <span>{{ category.label }}</span>
            <span class="count">{{ categoryCounts[category.key] ?? 0 }}</span>
          </button>
        </aside>

        <section class="super-clipboard-list-pane">
          <label class="super-clipboard-search">
            <AppIcon name="search" />
            <input
              v-model.trim="searchText"
              type="search"
              placeholder="搜索预览内容…"
              :disabled="!supported"
              @input="scheduleSearch"
            />
          </label>

          <p v-if="statusMessage" class="super-clipboard-status">{{ statusMessage }}</p>
          <span v-if="copyStatus" class="tool-copy-toast" role="status">{{ copyStatus }}</span>

          <div v-if="loading" class="super-clipboard-empty">加载中…</div>
          <div v-else-if="items.length === 0" class="super-clipboard-empty">
            <AppIcon :name="clipboardIcon" />
            <strong>暂无记录</strong>
            <p>复制内容后会自动加密保存到这里</p>
          </div>
          <ul v-else class="super-clipboard-list">
            <li v-for="item in items" :key="item.id">
              <button
                type="button"
                class="super-clipboard-item"
                :class="{ active: selectedId === item.id }"
                @click="selectItem(item)"
              >
                <span class="super-clipboard-item-top">
                  <span class="tag" :data-category="item.category">{{ CATEGORY_LABELS[item.category] }}</span>
                  <span class="time">{{ formatTime(item.createdAt) }}</span>
                </span>
                <span v-if="item.type === 'image'" class="super-clipboard-item-image-row">
                  <span class="super-clipboard-item-thumbnail">
                    <img
                      v-if="item.thumbnailDataUrl"
                      :src="item.thumbnailDataUrl"
                      alt=""
                      aria-hidden="true"
                      draggable="false"
                    />
                    <AppIcon v-else name="image" />
                  </span>
                </span>
                <span v-else class="preview">{{ item.preview }}</span>
              </button>
            </li>
          </ul>
          <p v-if="total > items.length" class="super-clipboard-more">显示最近 {{ items.length }} / {{ total }} 条</p>
        </section>

        <section class="super-clipboard-detail-pane">
          <div v-if="!detail" class="super-clipboard-empty detail">
            <strong>选择一条记录</strong>
            <p>在左侧点击可查看完整内容</p>
          </div>
          <template v-else>
            <div class="super-clipboard-detail-head">
              <div class="super-clipboard-detail-title">
                <span class="tag" :data-category="detail.category">{{ CATEGORY_LABELS[detail.category] }}</span>
                <span class="meta">{{ formatTime(detail.createdAt) }} · {{ detail.charCount }} 字符</span>
              </div>
              <div class="super-clipboard-detail-actions">
                <button class="tool-icon-button" type="button" title="复制" aria-label="复制" @click="handleCopy()">
                  <AppIcon name="copy" />
                </button>
                <button
                  class="tool-icon-button danger"
                  type="button"
                  title="删除"
                  aria-label="删除"
                  @click="handleDelete()"
                >
                  <AppIcon name="close" />
                </button>
              </div>
            </div>

            <div class="super-clipboard-detail-body">
              <button
                v-if="detail.imagePreviewDataUrl"
                class="super-clipboard-image-button"
                type="button"
                aria-label="查看大图"
                @click="imagePreviewOpen = true"
              >
                <img class="super-clipboard-image" :src="detail.imagePreviewDataUrl" alt="剪贴板图片" />
              </button>
              <div v-else-if="detail.type === 'image'" class="super-clipboard-empty detail">
                <AppIcon name="image" />
                <strong>图片预览不可用</strong>
              </div>
              <JsonCodeViewer v-else-if="detailJsonDisplay" :value="detailJsonDisplay" />
              <textarea
                v-else-if="detail.text"
                class="super-clipboard-text"
                readonly
                :value="detail.text"
                spellcheck="false"
              />
              <textarea
                v-else-if="detail.html"
                class="super-clipboard-text"
                readonly
                :value="detail.html"
                spellcheck="false"
              />
            </div>
          </template>
        </section>
      </div>

      <Teleport to="body">
        <div
          v-if="imagePreviewOpen && detail?.imagePreviewDataUrl"
          class="super-clipboard-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
          @click="imagePreviewOpen = false"
        >
          <button
            class="super-clipboard-lightbox-close"
            type="button"
            aria-label="关闭"
            @click.stop="imagePreviewOpen = false"
          >
            <AppIcon name="close" />
          </button>
          <img
            class="super-clipboard-lightbox-image"
            :src="detail.imagePreviewDataUrl"
            alt="剪贴板图片预览"
            @click.stop
          />
        </div>
      </Teleport>
    </div>
  </ToolPanel>
</template>
