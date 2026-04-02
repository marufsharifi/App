import {useFonts} from '@shopify/react-native-skia';
import {useMemo} from 'react';
import {Platform} from 'react-native';
import {createParagraphLabelRenderer} from 'victory-native';
import type { AxisLabelRenderer} from 'victory-native';
import fontSource, {paragraphFontSource} from '@components/Charts/font';

function useChartParagraphLabelRenderer(fontSize: number): AxisLabelRenderer | undefined {
    const cjkFontMgr = useFonts({
    NotoSansCJK: [
      Platform.OS === "web" ? { default: paragraphFontSource } : paragraphFontSource,
    ],
    ExpensifyNeue: [Platform.OS === "web" ? { default: fontSource } : fontSource,]
  });

    return useMemo(
        () =>
            cjkFontMgr && cjkFontMgr.countFamilies() > 0
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
}

export default useChartParagraphLabelRenderer;
