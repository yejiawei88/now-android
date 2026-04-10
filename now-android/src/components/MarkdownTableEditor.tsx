import React, { useCallback, useRef } from 'react';
import { HotTable } from '@handsontable/react';
import { TextCellType } from 'handsontable/cellTypes/textType';
import { registerCellType } from 'handsontable/cellTypes/registry';
import { TextEditor } from 'handsontable/editors/textEditor';
import { registerEditor } from 'handsontable/editors/registry';
import { registerLanguageDictionary } from 'handsontable/i18n/registry';
import zhCN from 'handsontable/i18n/languages/zh-CN';
import { AutoColumnSize } from 'handsontable/plugins/autoColumnSize';
import { ContextMenu } from 'handsontable/plugins/contextMenu';
import { CopyPaste } from 'handsontable/plugins/copyPaste';
import { ManualColumnResize } from 'handsontable/plugins/manualColumnResize';
import { ManualRowResize } from 'handsontable/plugins/manualRowResize';
import { UndoRedo } from 'handsontable/plugins/undoRedo';
import { registerPlugin } from 'handsontable/plugins/registry';
import { textRenderer } from 'handsontable/renderers/textRenderer';
import { registerRenderer } from 'handsontable/renderers/registry';
import 'handsontable/styles/handsontable.min.css';

let handsontableRegistered = false;

const ensureHandsontableModules = () => {
    if (handsontableRegistered) return;
    handsontableRegistered = true;

    registerCellType(TextCellType);
    registerEditor(TextEditor);
    registerRenderer(textRenderer);
    registerLanguageDictionary(zhCN);

    [
        AutoColumnSize,
        ContextMenu,
        CopyPaste,
        ManualColumnResize,
        ManualRowResize,
        UndoRedo,
    ].forEach(registerPlugin);
};

ensureHandsontableModules();

interface MarkdownTableEditorProps {
    initialRows: string[][];
    onSync: (rows: string[][]) => void;
}

const MarkdownTableEditor: React.FC<MarkdownTableEditorProps> = ({ initialRows, onSync }) => {
    const hotRef = useRef<any>(null);

    const sync = useCallback(() => {
        if (hotRef.current?.hotInstance) {
            onSync(hotRef.current.hotInstance.getData());
        }
    }, [onSync]);

    return (
        <div className="hot-container dark-theme-table">
            <div className="hot-viewport-pro">
                <HotTable
                    ref={hotRef}
                    data={initialRows}
                    rowHeaders={false}
                    colHeaders={false}
                    height="auto"
                    width="100%"
                    autoColumnSize={true}
                    manualColumnResize={true}
                    manualRowResize={true}
                    language="zh-CN"
                    cells={(row, col) => {
                        const cellProperties: any = {};
                        const classes = [];
                        if (row === 0) classes.push('htHeaderRow');
                        if (col === 0) classes.push('htFirstColumn');

                        if (classes.length > 0) {
                            cellProperties.className = classes.join(' ');
                        }

                        return cellProperties;
                    }}
                    contextMenu={{
                        items: {
                            row_above: {},
                            row_below: {},
                            col_left: {},
                            col_right: {},
                            remove_row: {},
                            remove_col: {},
                            alignment: {
                                submenu: {
                                    items: [
                                        { key: 'alignment:left' },
                                        { key: 'alignment:right' },
                                        { key: 'alignment:middle' },
                                    ],
                                },
                            },
                        },
                    }}
                    licenseKey="non-commercial-and-evaluation"
                    afterChange={(_changes, source) => {
                        if (source !== 'loadData') sync();
                    }}
                    afterRemoveRow={sync}
                    afterRemoveCol={sync}
                    afterCreateRow={sync}
                    afterCreateCol={sync}
                    afterColumnResize={sync}
                />
            </div>
        </div>
    );
};

export default MarkdownTableEditor;
