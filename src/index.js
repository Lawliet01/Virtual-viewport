import cssParser from './cssParser/index.js'

const iterateStyleSheets = (styleSheets, callback) => {
    for (let styleSheet of styleSheets) {
        const cssRuleList = styleSheet.cssRules;
        for (let cssRule of cssRuleList) {
            callback(cssRule, styleSheet);
        }
    }
}

const iterateElements = (childrenGroup, callback) => {
    for (let el of childrenGroup) {
        const descendants = el.getElementsByTagName('*');
        for (let descendant of descendants) {
            callback(descendant);
        }
    }
};

const replaceRule = (styleSheet, newRule, oldRule) => {
    const index = Array.from(styleSheet.cssRules).indexOf(oldRule)
    if (index === -1) return;
    styleSheet.deleteRule(index)
    
    styleSheet.insertRule(newRule, index)
    return styleSheet.cssRules[index]
}

const vwToPx = (value, containerWidth)=> {
    value = Number(value)
    if (isNaN(value)) throw new Error('wrong type')
    return containerWidth * value / 100 + 'px'
}

const isMatchMedia = (rule, containerSize) => {
    // TODO: 使用更加专业的正则匹配(考虑not/only/and em等等)
    const regex = /(\d+)px/;

    const mediaQueryMatch = regex.exec(rule)[1]

    const { containerWidth : virtualWidth, containerHeight : virtualHeight } = containerSize;

    const {width: realWidth, height: realHeight} = window.visualViewport

    const virtualMediaQuery = Number(mediaQueryMatch) * realWidth / virtualWidth

    const testRule = rule.replace(mediaQueryMatch, virtualMediaQuery);

    return window.matchMedia(testRule).matches

}

const disableMediaQuery = 'screen and (max-width: 1px)';
const endableMediaQuery = 'screen and (max-width: 10000px)';

export default class ViewPort {
    constructor(container) {
        this.container = container;
        this.container.style.contain = 'strict'
        this.container.style.display = 'block'
        this.shadowRoot = container.shadowRoot

        this.styleSheetRecords = new Map();
        this.mediaQueryRecords = new Map();

        iterateStyleSheets(this.shadowRoot.styleSheets, (cssRule, styleSheet) => {
            const ast = cssParser.parse(cssRule.cssText);

            const astRule = ast.stylesheet.rules[0];

            if (astRule.type === 'rule') {
                const { declarations } = astRule;

                for (let declaration of declarations) {
                    // TODO: 检测是否有vh / vmin / vmax单位的属性
                    const { value } = declaration;

                    if (!value.endsWith('vw')) continue;

                    if (!this.styleSheetRecords.has(styleSheet)) this.styleSheetRecords.set(styleSheet, new Map());

                    const styleSheetRecord = this.styleSheetRecords.get(styleSheet);

                    if (!styleSheetRecord.has(cssRule)) {
                        styleSheetRecord.set(cssRule, {
                            ast,
                            currRule: cssRule,
                            declarations: [],
                        });
                    }

                    const cssRuleRecord = styleSheetRecord.get(cssRule);

                    const [_, digit, unit] = value.match(/(\d+)(.*)/);

                    cssRuleRecord.declarations.push({
                        originalValue: digit,
                        unit,
                        declaration,
                    });
                }
            } else if (astRule.type === 'media') {
                if (!this.mediaQueryRecords.has(styleSheet)) this.mediaQueryRecords.set(styleSheet, new Map());

                const mediaQueryRecord = this.mediaQueryRecords.get(styleSheet);

                if (!mediaQueryRecord.has(cssRule)) {
                    mediaQueryRecord.set(cssRule, {
                        ast,
                        astRule,
                        currRule: cssRule,
                        originalMedia: astRule.media,
                        declarations: [],
                    });
                }

                const cssRuleRecord = mediaQueryRecord.get(cssRule);

                for (let normalRule of astRule.rules) {
                    if (normalRule.type !== 'rule') continue;

                    for (let declaration of normalRule.declarations) {
                        const { value } = declaration;

                        if (!value.endsWith('vw')) continue;

                        const [_, digit, unit] = value.match(/(\d+)(.*)/);

                        cssRuleRecord.declarations.push({
                            originalValue: digit,
                            unit,
                            declaration,
                        });
                    }
                }

                astRule.media = disableMediaQuery;

                const newRule = replaceRule(styleSheet, cssParser.stringify(ast), cssRule);
                cssRuleRecord.currRule = newRule;
            }
        });

        this.inlineStyleRecord = new Map();
        

        iterateElements(this.container.shadowRoot.children, (e) => {
            this.collectInlineStyleElements(e);
        });

        // console.log(this.styleSheetRecords);
        // console.log(this.mediaQueryRecords);
        // console.log(this.inlineStyleRecord);
        
        this.observer = new ResizeObserver((entries) => {
            const { inlineSize: containerWidth, blockSize: containerHeight } = entries[0].contentBoxSize[0];

            // 对stylesheet的改变
            // 虽然是3层循环 但是时间复杂度依旧是O(N)
            for (let [styleSheet, record] of this.styleSheetRecords){

                for (let cssRule of record.values() ) {

                    const { declarations, currRule, ast } = cssRule
                    
                    for (let {declaration, originalValue} of declarations) {

                        declaration.value = vwToPx(originalValue, containerWidth);
                    }

                    const newRule = replaceRule(styleSheet, cssParser.stringify(ast), currRule);

                    cssRule.currRule = newRule
                }
            }

            for (let [styleSheet, record] of this.mediaQueryRecords){

                for (let cssRule of record.values() ){

                    const { declarations, currRule, ast , astRule, originalMedia} = cssRule;

                    if (isMatchMedia(originalMedia, { containerWidth, containerHeight })) {

                        astRule.media = endableMediaQuery

                        for (let {declaration, originalValue} of declarations) {
    
                            declaration.value = vwToPx(originalValue, containerWidth);
                        }

                    } else {

                        astRule.media = disableMediaQuery;
                    }

                    const newRule = replaceRule(styleSheet, cssParser.stringify(ast), currRule);
    
                    cssRule.currRule = newRule;
                }
            }

            for (let [el, storeEntries] of this.inlineStyleRecord) {
                for (let [property, {originalValue, unit}] of storeEntries) {
                    // TODO: 添加vh / vmin / vmax逻辑
                    switch (unit) {
                        case 'vw':
                            el.style[property] = vwToPx(originalValue, containerWidth);
                            break;
                    }
                }
            }
        });

        this.observer.observe(this.container);
    }

    collectInlineStyleElements(e) {
        if (!e.style.length) return;

        for (let i = 0; i < e.style.length; i++) {
            const property = e.style[i];

            const value = e.style[property];

            const [_, digit, unit] = value.match(/(\d+)(.*)/);

            if (unit !== 'vw') continue;

            if (!this.inlineStyleRecord.has(e)) {
                this.inlineStyleRecord.set(e, new Map())
            }

            const vwPropertyStore = this.inlineStyleRecord.get(e);

            vwPropertyStore.set(property, {
                originalValue: digit,
                unit,
            });
        }
    }
}
