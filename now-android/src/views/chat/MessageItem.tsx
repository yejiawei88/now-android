import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import Icon from '../../components/Icon';
import { BackendService } from '../../backend';
import { normalizeMarkdownForRender } from '../../utils/markdownNormalize';
import type { Message } from './types';
import { getMessageText } from './messageUtils';

const backend = BackendService.getInstance();

export const MessageItem = React.memo(
  ({
    msg,
    idx,
    isUser,
    t,
    downloadImage,
    onApplySelection,
    onQuoteSelection,
    hideCopyButton = false,
  }: {
    msg: Message;
    idx: number;
    isUser: boolean;
    t: any;
    downloadImage: (url: string) => void;
    onApplySelection?: (text: string) => void;
    onQuoteSelection?: (text: string) => void;
    hideCopyButton?: boolean;
  }) => {
    const messageText = getMessageText(msg, t.image_placeholder);
    const renderedText = React.useMemo(
      () => normalizeMarkdownForRender(messageText),
      [messageText]
    );
    const bubbleRef = React.useRef<HTMLDivElement | null>(null);
    const latestSelectedTextRef = React.useRef<string>('');
    const lastAutoQuotedRef = React.useRef<{ text: string; ts: number }>({
      text: '',
      ts: 0,
    });
    const [showActions, setShowActions] = React.useState(false);

    // Check if device is touch-enabled
    const isTouchDevice = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

    const getSelectedTextInBubble = React.useCallback(() => {
      const bubble = bubbleRef.current;
      const selection = window.getSelection();
      if (!bubble || !selection || selection.rangeCount === 0) return '';
      const selectedText = selection.toString().trim();
      if (!selectedText) return '';

      for (let i = 0; i < selection.rangeCount; i += 1) {
        const range = selection.getRangeAt(i);
        if (bubble.contains(range.commonAncestorContainer)) {
          return selectedText;
        }
      }
      return '';
    }, []);

    const captureSelectedText = React.useCallback(() => {
      latestSelectedTextRef.current = getSelectedTextInBubble();
    }, [getSelectedTextInBubble]);

    const applyQuoteFromSelection = React.useCallback(() => {
      if (isUser || !onQuoteSelection) return;
      const bubble = bubbleRef.current;
      const selection = window.getSelection();
      if (!bubble || !selection || selection.rangeCount === 0) return;

      const selectedText = selection.toString().trim();
      if (!selectedText) return;

      let isInsideBubble = false;
      for (let i = 0; i < selection.rangeCount; i += 1) {
        const range = selection.getRangeAt(i);
        if (bubble.contains(range.commonAncestorContainer)) {
          isInsideBubble = true;
          break;
        }
      }

      if (!isInsideBubble) return;
      latestSelectedTextRef.current = selectedText;
      const now = Date.now();
      if (
        lastAutoQuotedRef.current.text === selectedText &&
        now - lastAutoQuotedRef.current.ts < 250
      ) {
        return;
      }
      lastAutoQuotedRef.current = { text: selectedText, ts: now };
      onQuoteSelection(selectedText);
    }, [isUser, onQuoteSelection]);

    const scheduleApplyQuoteFromSelection = React.useCallback(() => {
      // Delay one tick so browser selection is finalized (fixes double-click/drag stale selection).
      window.setTimeout(() => {
        applyQuoteFromSelection();
      }, 0);
    }, [applyQuoteFromSelection]);

    const handleMouseUp = React.useCallback(() => {
      captureSelectedText();
      scheduleApplyQuoteFromSelection();
    }, [captureSelectedText, scheduleApplyQuoteFromSelection]);

    const handleQuote = React.useCallback(() => {
      if (!onQuoteSelection) return;
      const selected = latestSelectedTextRef.current || getSelectedTextInBubble();
      const textToQuote = (selected || messageText).trim();
      if (!textToQuote) return;
      onQuoteSelection(textToQuote);
    }, [getSelectedTextInBubble, messageText, onQuoteSelection]);

    const handleBubbleClick = React.useCallback(() => {
        if (isTouchDevice) {
            setShowActions(prev => !prev);
        }
    }, [isTouchDevice]);

    return (
      <div
        key={idx}
        className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'} group animate-in fade-in slide-in-from-bottom-2 duration-300`}
        onClick={handleBubbleClick}
      >
        <div
          className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-[85%]`}
        >
          <div
            ref={bubbleRef}
            onMouseUp={handleMouseUp}
            onDoubleClick={scheduleApplyQuoteFromSelection}
            onKeyUp={captureSelectedText}
            className={`px-4 py-3 rounded-2xl text-[15px] leading-relaxed break-words select-text cursor-text ${
              isUser
                ? 'bg-[#282A2C] text-[#A1A1AA] font-semibold tracking-wider whitespace-pre-wrap'
                : 'bg-[#09090B] text-[#A1A1AA]'
            }`}
          >
            {(() => {
              const images = (() => {
                if (Array.isArray(msg.content)) {
                  const imgs = msg.content
                    .filter((p) => p.type === 'image_url' && p.image_url)
                    .map((p) => p.image_url!.url);
                  if (imgs.length > 0) return imgs;
                }
                return msg.imagePreview ? [msg.imagePreview] : [];
              })();

              if (images.length === 0) return null;

              return (
                <div
                  className={`grid gap-2 mb-3 ${
                    images.length > 1 ? 'grid-cols-2' : 'grid-cols-1'
                  }`}
                >
                  {images.map((img, imgIdx) => (
                    <div key={imgIdx} className="relative group/img">
                      <img
                        src={img}
                        alt={`uploaded-${imgIdx}`}
                        className="max-w-full rounded-lg object-contain cursor-pointer hover:opacity-90 transition-opacity border border-white/5"
                        style={{
                          maxHeight: images.length > 1 ? '150px' : '300px',
                        }}
                        onClick={() => downloadImage(img)}
                        title={t.click_download}
                      />
                    </div>
                  ))}
                </div>
              );
            })()}

            <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-[#1C1C1E] prose-pre:p-0 prose-code:bg-transparent prose-code:p-0 prose-ul:list-disc prose-ul:ml-4 prose-ol:list-decimal prose-ol:ml-4 prose-li:my-0.5 prose-p:my-1.5 prose-headings:my-2 prose-headings:text-white/90 prose-headings:font-bold prose-strong:text-white/90 prose-p:text-[#A1A1AA] prose-li:text-[#A1A1AA] prose-p:tracking-wider prose-li:tracking-wider">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  table({ children }: any) {
                    return (
                      <div className="my-3 max-w-full overflow-x-auto rounded-xl border border-white/10 bg-[#0B0B0E]">
                        <table className="!my-0 !w-max border-separate border-spacing-0">
                          {children}
                        </table>
                      </div>
                    );
                  },
                  th({ children }: any) {
                    return (
                      <th className="border-b border-r border-white/10 bg-white/[0.03] px-3 py-2 text-left font-semibold text-white/90 last:border-r-0">
                        {children}
                      </th>
                    );
                  },
                  td({ children }: any) {
                    return (
                      <td className="border-b border-r border-white/[0.06] px-3 py-2 text-[#A1A1AA] last:border-r-0">
                        {children}
                      </td>
                    );
                  },
                  tr({ children }: any) {
                    return (
                      <tr className="even:bg-white/[0.01] last:[&>td]:border-b-0">
                        {children}
                      </tr>
                    );
                  },
                  code({ inline, className, children, ...props }: any) {
                    const match = /language-(\w+)/.exec(className || '');
                    return !inline && match ? (
                      <div className="relative group/code my-2 rounded-lg overflow-hidden border border-white/5">
                        <div className="flex items-center justify-between px-3 py-1.5 bg-[#1C1C1E] text-[11px] text-white/80 border-b border-white/5">
                          <span>{match[1].toUpperCase()}</span>
                          <button
                            onClick={() => {
                              void backend.writeClipboard(
                                String(children).replace(/\n$/, '')
                              );
                            }}
                            className="hover:text-white transition-colors flex items-center gap-1"
                          >
                            <Icon
                              name="content_copy"
                              className="!text-[12px]"
                              size={12}
                            />
                            {t.copy}
                          </button>
                        </div>
                        <pre className="m-0 p-3 text-[13px] overflow-x-auto bg-transparent">
                          <code className={className} {...props}>
                            {String(children).replace(/\n$/, '')}
                          </code>
                        </pre>
                      </div>
                    ) : (
                      <code
                        className={`${className} bg-white/10 px-1.5 py-0.5 rounded text-[#FF9F0A]`}
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {renderedText}
              </ReactMarkdown>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-1 px-1">
            {!hideCopyButton && (
              <button
                onClick={(e) => { e.stopPropagation(); void backend.writeClipboard(messageText); }}
                className={`transition-opacity text-xs text-white/80 hover:text-white flex items-center gap-1 ${showActions || !isTouchDevice ? 'opacity-100 group-hover:opacity-100' : 'opacity-0'}`}
              >
                <Icon name="content_copy" className="text-[14px]" size={14} />
                {t.copy}
              </button>
            )}

            {!isUser && onQuoteSelection && (
              <button
                onMouseDown={captureSelectedText}
                onClick={(e) => { e.stopPropagation(); handleQuote(); }}
                className={`transition-opacity text-xs text-white/80 hover:text-white flex items-center gap-1 ${showActions || !isTouchDevice ? 'opacity-100 group-hover:opacity-100' : 'opacity-0'}`}
                title={
                  t.quote_selection ||
                  (t.language === 'zh' ? '引用选中文本' : 'Quote selected text')
                }
              >
                <Icon name="format_quote" className="text-[14px]" size={14} />
                {t.quote || (t.language === 'zh' ? '引用' : 'Quote')}
              </button>
            )}

            {!isUser && onApplySelection && (
              <button
                onClick={(e) => { e.stopPropagation(); onApplySelection(messageText); }}
                className={`transition-opacity text-xs text-white/80 hover:text-white flex items-center gap-1 ${showActions || !isTouchDevice ? 'opacity-100 group-hover:opacity-100' : 'opacity-0'}`}
                title={
                  t.apply_to_editor ||
                  (t.language === 'zh' ? '应用到编辑器' : 'Apply to editor')
                }
              >
                <Icon name="done" className="text-[14px]" size={14} />
                {t.apply || (t.language === 'zh' ? '应用' : 'Apply')}
              </button>
            )}
          </div>
        </div>

      </div>
    );
  }
);

MessageItem.displayName = 'MessageItem';

