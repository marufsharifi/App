
Use this version.

## Proposal

### Please re-state the problem that we are trying to solve in this issue.

On Search charts, X-axis month labels with CJK characters (Japanese/Chinese/Korean) render incorrectly, while the same strings render correctly in normal React Native `Text`. This makes chart labels unreadable in localized views.

### What is the root cause of that problem?

The root cause is **font fallback differences between rendering pipelines**.

- Chart labels are drawn on the Skia canvas (via Victory) using a specific chart font (`ExpensifyNeue-Regular`).
- Normal RN `Text` uses the platform text stack, which has automatic font fallback.
- When `ExpensifyNeue-Regular` does not contain CJK glyphs, canvas text has missing glyphs and labels break.

So this is not a translation/string issue; it is a **font fallback issue** in chart-canvas text rendering.

Reference:

- `src/components/Charts/font/index.ts`
  https://github.com/Expensify/App/blob/c1c51b4d2577f389fc8d19d055e59e78dcbd0f9b/src/components/Charts/font/index.ts#L3

---

## Solution 1: App-level platform-aware fallback

Use a **platform-aware minimal fallback** that keeps current chart behavior:

1. Keep the existing chart font as default.
2. Detect unsupported glyphs using `font.getGlyphIDs()` (`glyphId === 0` means unsupported).
3. On native, use `matchFont(...)` only when unsupported labels are detected.
4. On web, avoid `matchFont(...)` (not implemented), and use RN `Text` overlay for X-axis labels only when unsupported glyphs are detected.
5. Keep existing truncation, rotation, skip logic, and chart interactions unchanged.

### Code

```ts
function canFontRenderText(font: SkFont, text: string): boolean {
    const glyphIDs = font.getGlyphIDs(text);
    return glyphIDs.every((id) => id !== 0);
}
```

```ts
const xAxisFont = useMemo(() => {
    if (!font) {
        return null;
    }

    const hasUnsupportedLabel = data.some((point) => !canFontRenderText(font, point.label));
    const canUseMatchFont = Platform.OS !== 'web';

    return hasUnsupportedLabel && canUseMatchFont
        ? matchFont({fontSize: variables.iconSizeExtraSmall})
        : font;
}, [data, font]);
```

```ts
const hasUnsupportedLabel = useMemo(
    () => data.some((point) => !font || !canFontRenderText(font, point.label)),
    [data, font],
);

const shouldUseWebTextFallback = Platform.OS === 'web' && hasUnsupportedLabel;
```

```tsx
xAxis={{
    font: xAxisFont ?? font,
    tickCount: data.length,
    labelColor: theme.textSupporting,
    lineWidth: X_AXIS_LINE_WIDTH,
    labelOffset: AXIS_LABEL_GAP - Math.abs((xAxisFont ?? font)?.getMetrics().descent ?? 0),
    formatXLabel: shouldUseWebTextFallback ? () => '' : formatXAxisLabel,
    labelRotate: labelRotation,
}}
```

```tsx
{shouldUseWebTextFallback && (
    <View pointerEvents="none" style={[styles.pAbsolute, styles.t0, styles.l0, styles.r0, styles.b0]}>
        {xAxisLabels}
    </View>
)}
```

This fixes the issue at the app layer and preserves the localized label text. However, it is still an app-specific workaround around the underlying chart-library limitation.

---

## Solution 2: Upstream fix in `victory-native-xl`

Fix the actual limitation in the chart library:

- Library: https://github.com/FormidableLabs/victory-native-xl
- Related issue: https://github.com/FormidableLabs/victory-native-xl/issues/611
- React Native Skia Paragraph API: https://shopify.github.io/react-native-skia/docs/text/paragraph/

It is proposed that `victory-native-xl` leverage the `react-native-skia` Paragraph API to render axis labels. This would allow developers to specify different fonts for various parts of the label text, enabling seamless support for multi-language applications. The implementation could involve extending the existing `axisOptions` to accept parameters that can be used to construct a Skia Paragraph object, or by providing a new prop for more advanced text rendering scenarios.

The important part is that the library must solve both:

- label rendering
- label measurement for layout

Below is the step-by-step library change.

### 1. Update the axis API to support a custom label renderer

Add an opt-in renderer contract so the axis system no longer assumes every label must be measured and rendered by a single `SkFont`.

This should be done in:

- `lib/src/types.ts`

### Code

```ts
export type AxisLabelDimensions = {
  width: number;
  height: number;
};

export type AxisLabelRenderArgs = {
  text: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  origin?: SkPoint;
};

export type AxisLabelRenderer = {
  measureText: (text: string) => AxisLabelDimensions;
  render: (args: AxisLabelRenderArgs) => React.ReactNode;
};
```

```ts
export type XAxisInputProps<...> = {
  axisSide?: XAxisSide;
  font?: SkFont | null;
  labelRenderer?: AxisLabelRenderer;
  ...
};

export type YAxisInputProps<...> = {
  axisSide?: YAxisSide;
  font?: SkFont | null;
  labelRenderer?: AxisLabelRenderer;
  ...
};
```

### 2. Add a shared measurement utility that supports both the old font path and the new renderer path

Move label measurement behind one helper so the same measurement logic can be used everywhere in the chart system.

This should be done in:

- `lib/src/utils/getLabelDimensions.ts`

### Code

```ts
export const getLabelDimensions = ({
  text,
  font,
  labelRenderer,
}: {
  text: string;
  font?: SkFont | null;
  labelRenderer?: AxisLabelRenderer;
}): AxisLabelDimensions => {
  if (labelRenderer) {
    return labelRenderer.measureText(text);
  }

  const width =
    font
      ?.getGlyphWidths(font.getGlyphIDs(text))
      .reduce((sum, value) => sum + value, 0) ?? 0;

  return {
    width,
    height: font?.getSize() ?? 0,
  };
};
```

### 3. Add a Paragraph-based label renderer helper

Provide a helper that uses Skia Paragraph with fallback font families and a `TypefaceFontProvider`. This becomes the reusable advanced text path for multilingual labels.

This should be done in:

- `lib/src/cartesian/utils/createParagraphLabelRenderer.tsx`

### Code

```ts
export type CreateParagraphLabelRendererOptions = {
  paragraphStyle?: SkParagraphStyle;
  textStyle?: Omit<SkTextStyle, 'color'> & {color?: SkColor};
  typefaceFontProvider?: SkTypefaceFontProvider;
};
```

```ts
export const createParagraphLabelRenderer = ({
  paragraphStyle,
  textStyle,
  typefaceFontProvider,
}: CreateParagraphLabelRendererOptions = {}): AxisLabelRenderer => ({
  measureText: (text) => {
    const {width, height} = buildParagraph({
      text,
      paragraphStyle,
      textStyle,
      typefaceFontProvider,
    });

    return {width, height};
  },
  render: ({text, color, x, y, width}) => {
    const {paragraph} = buildParagraph({
      text,
      color,
      paragraphStyle,
      textStyle,
      typefaceFontProvider,
    });

    return <Paragraph paragraph={paragraph} x={x} y={y} width={width} />;
  },
});
```

### 4. Update `XAxis` to use renderer-driven measurement and rendering

Make `XAxis` support either:

- the current `font` + `Text` path
- or the new `labelRenderer` path

This should be done in:

- `lib/src/cartesian/components/XAxis.tsx`

### Code

```ts
const {width: labelWidth, height: labelHeight} = getLabelDimensions({
  text: contentX,
  font,
  labelRenderer,
});
```

```tsx
{(font || labelRenderer) && labelWidth && canFitLabelContent ? (
  <Group transform={[{translateY: rotateOffset}]}>
    {labelRenderer ? (
      <Group
        transform={[{rotate: (Math.PI / 180) * (labelRotate ?? 0)}]}
        origin={origin}
      >
        {labelRenderer.render({
          text: contentX,
          color: labelColor,
          x: labelX,
          y: labelY,
          width: labelWidth,
          height: labelHeight,
          rotation: labelRotate ?? 0,
          origin,
        })}
      </Group>
    ) : (
      <Text
        transform={[{rotate: (Math.PI / 180) * (labelRotate ?? 0)}]}
        origin={origin}
        color={labelColor}
        text={contentX}
        font={font ?? null}
        y={labelY}
        x={labelX}
      />
    )}
  </Group>
) : null}
```

### 5. Update `YAxis` to use renderer-driven measurement and rendering

Make `YAxis` support the same dual path as `XAxis`.

This should be done in:

- `lib/src/cartesian/components/YAxis.tsx`

### Code

```ts
const {width: labelWidth, height: labelHeight} = getLabelDimensions({
  text: contentY,
  font,
  labelRenderer,
});
```

```tsx
{(font || labelRenderer)
  ? canFitLabelContent && (
      <>
        {labelRenderer
          ? labelRenderer.render({
              text: contentY,
              color: labelColor,
              x: labelX,
              y: labelY,
              width: labelWidth,
              height: labelHeight,
            })
          : (
            <Text
              color={labelColor}
              text={contentY}
              font={font ?? null}
              y={labelY}
              x={labelX}
            />
          )}
      </>
    )
  : null}
```

### 6. Update layout calculation to use the renderer for label measurement

Update the chart layout path so plot bounds, spacing, and label offsets are calculated from the same renderer that actually draws the labels.

This should be done in:

- `lib/src/cartesian/utils/transformInputData.ts`

### Code

```ts
const xLabelMeasurements = xTicksNormalized.map((xTick) => {
  const labelValue = xAxis.formatXLabel
    ? xAxis.formatXLabel(
        xTick as unknown as Parameters<typeof xAxis.formatXLabel>[0],
      )
    : String(xTick);

  return getLabelDimensions({
    text: String(labelValue),
    font: xAxis.font,
    labelRenderer: xAxis.labelRenderer,
  });
});
```

```ts
const maxYLabel = Math.max(
  0,
  ...yTicksNormalized.map((yTick) =>
    getLabelDimensions({
      text: yAxis?.formatYLabel?.(yTick as RawData[YK]) || String(yTick),
      font: yAxis.font,
      labelRenderer: yAxis.labelRenderer,
    }).width,
  ),
);
```

This step is critical. Without it, labels may render correctly but chart bounds and spacing would still be calculated using the wrong single-font assumptions.

### 7. Export the new helper from the public API

Expose the helper so apps can consume the new renderer path.

This should be done in:

- `lib/src/index.ts`

### Code

```ts
export {createParagraphLabelRenderer} from './cartesian/utils/createParagraphLabelRenderer';
export {type AxisLabelRenderer} from './types';
```

---

## App changes needed alongside the library changes

Even with the library fixed, the app still needs some integration work so it can actually use the new upstream capability.

### 1. Add a chart-specific paragraph renderer hook

Load the fallback-capable chart font(s) and construct a Paragraph renderer for chart labels.

This should be done in:

- `src/components/Charts/hooks/useChartParagraphLabelRenderer.ts`

### Code

```ts
const cjkFontMgr = useFonts({
  NotoSansCJK: [
    Platform.OS === 'web' ? {default: notoSansCJK} : notoSansCJK,
  ],
});

const paragraphLabelRenderer = useMemo(
  () =>
    cjkFontMgr
      ? createParagraphLabelRenderer({
          textStyle: {
            fontSize,
            fontFamilies: ['ExpensifyNeue', 'NotoSansCJK'],
          },
          typefaceFontProvider: cjkFontMgr,
        })
      : undefined,
  [cjkFontMgr, fontSize],
);
```

### 2. Pass the renderer into chart axes

Use the new upstream `labelRenderer` support for both X and Y axis paths where localized labels may contain unsupported glyphs.

This should be done in:

- `src/components/Charts/LineChart/LineChartContent.tsx`
- `src/components/Charts/BarChart/BarChartContent.tsx`

### Code

```tsx
yAxis={[
  {
    font,
    labelRenderer: paragraphLabelRenderer,
    labelColor: theme.textSupporting,
    formatYLabel: formatValue,
    tickCount: Y_AXIS_TICK_COUNT,
    lineWidth: Y_AXIS_LINE_WIDTH,
    lineColor: theme.border,
    labelOffset: AXIS_LABEL_GAP,
    domain: yAxisDomain,
  },
]}
```

### 3. Update custom X-axis label rendering to use renderer-aware measurement

Expensify currently uses custom X-axis label rendering logic, so label measurement and rendering there must also use the same renderer.

This should be done in:

- `src/components/Charts/components/ChartXAxisLabels.tsx`
- `src/components/Charts/hooks/useChartLabelLayout.ts`
- `src/components/Charts/hooks/useLabelHitTesting.ts`
- `src/components/Charts/utils.ts`

### Code

```ts
function measureTextWidth(text: string, font: SkFont, labelRenderer?: AxisLabelRenderer): number {
    if (labelRenderer) {
        return labelRenderer.measureText(text).width;
    }

    const glyphIDs = font.getGlyphIDs(text);
    return font.getGlyphWidths(glyphIDs).reduce((sum, w) => sum + w, 0);
}
```

```ts
const {labelRotation, labelSkipInterval, truncatedLabels, xAxisLabelHeight} = useChartLabelLayout({
    data,
    font,
    labelRenderer: paragraphLabelRenderer,
    tickSpacing,
    labelAreaWidth: plotAreaWidth,
    ...
});
```

```tsx
<ChartXAxisLabels
    labels={truncatedLabels}
    labelRotation={labelRotation}
    labelSkipInterval={labelSkipInterval}
    font={font}
    labelRenderer={paragraphLabelRenderer}
    labelColor={theme.textSupporting}
    xScale={args.xScale}
    chartBoundsBottom={args.chartBounds.bottom}
/>
```

### 4. Keep a web fallback if Skia web font loading remains unreliable

If Skia web still cannot reliably create typefaces for the fallback font, keep the existing app-level web fallback as a safety net while native uses the new Paragraph renderer path.

### Code

```ts
const shouldUseWebTextFallback = Platform.OS === 'web' && hasUnsupportedLabel;
```

```tsx
formatXLabel: shouldUseWebTextFallback ? () => '' : formatXAxisLabel
```

```tsx
{shouldUseWebTextFallback && (
    <View pointerEvents="none" style={[styles.pAbsolute, styles.t0, styles.l0, styles.r0, styles.b0]}>
        {xAxisLabels}
    </View>
)}
```

---

## Recommendation

Use both layers together:

1. **Implement the app-level fix now** so Expensify can fix production behavior immediately.
2. **Implement the library-level fix in `victory-native-xl`** so the chart API properly supports multilingual, fallback-aware axis labels long-term.

This gives:

- immediate correctness in the app
- a proper upstream solution
- preserved localized strings
- no product regression from replacing CJK labels with numeric placeholders

If you want, I can also rewrite this one more time into a shorter final GitHub comment ready to paste as-is.
