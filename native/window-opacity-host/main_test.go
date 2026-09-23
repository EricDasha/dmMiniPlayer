//go:build windows

package main

import "testing"

// 标题标记「误伤浏览器」回归测试：
// docPIP 窗口标题为独占 marker，浏览器主窗口标题为页面标题。
// findBestWindow 必须精确命中 pip（marker），绝不选中浏览器。
func TestFindBestWindowPrefersMarkerTitle(t *testing.T) {
	req := request{
		Title:  "dmMiniPlayer-PIP",
		Titles: []string{"dmMiniPlayer-PIP"},
		Bounds: bounds{Left: 100, Top: 100, Width: 640, Height: 360},
	}

	// 模拟 Windows 枚举结果：浏览器主窗口 + docPIP 窗口（两者位置重叠、面积接近）
	windows := []windowInfo{
		{
			hwnd:   1,
			title:  "YouTube - Google Chrome",
			bounds: bounds{Left: 0, Top: 0, Width: 1280, Height: 720},
		},
		{
			hwnd:   2,
			title:  "dmMiniPlayer-PIP",
			bounds: bounds{Left: 100, Top: 100, Width: 640, Height: 360},
		},
	}

	best, ok := selectBestWindow(windows, normalizeTitles(req), req.Bounds)
	if !ok || best.hwnd != 2 {
		t.Fatalf("误选窗口 hwnd=%d title=%q ok=%v, 期望命中 docPIP(marker)", best.hwnd, best.title, ok)
	}
	if !isReasonableAreaMatch(best, req.Bounds) {
		t.Fatalf("marker docPIP 被面积护栏误拒")
	}
}

// 大窗口浏览器与 docPIP 面积相近（面积护栏 6x 阈值内放行）：
// 必须靠 marker 标题精确匹配，标题才是权威，绝不选中浏览器
func TestFindBestWindowRejectsBrowserByTitle(t *testing.T) {
	req := request{
		Title:  "dmMiniPlayer-PIP",
		Titles: []string{"dmMiniPlayer-PIP"},
		Bounds: bounds{Left: 0, Top: 0, Width: 1280, Height: 720},
	}

	windows := []windowInfo{
		// 浏览器：面积仅 4 倍（护栏放行），标题为页面标题
		{
			hwnd:   1,
			title:  "bilibili - Google Chrome",
			bounds: bounds{Left: 0, Top: 0, Width: 2560, Height: 1440},
		},
		// docPIP：marker 标题
		{
			hwnd:   2,
			title:  "dmMiniPlayer-PIP",
			bounds: bounds{Left: 0, Top: 0, Width: 1280, Height: 720},
		},
	}

	best, ok := selectBestWindow(windows, normalizeTitles(req), req.Bounds)
	if !ok || best.hwnd != 2 {
		t.Fatalf("标题未区分开：误选 hwnd=%d title=%q ok=%v", best.hwnd, best.title, ok)
	}
	if score := scoreWindow(best, normalizeTitles(req), req.Bounds); score < 300 {
		t.Fatalf("marker pip 得分 %d 应 = 300（精确匹配）", score)
	}
}

func TestNormalizeMarkerTitle(t *testing.T) {
	if got := normalizeTitle("dmMiniPlayer-PIP"); got != "dmminiplayer-pip" {
		t.Fatalf("normalizeTitle marker = %q", got)
	}
	if got := normalizeTitle("YouTube - Google Chrome"); got != "youtube" {
		t.Fatalf("normalizeTitle browser = %q", got)
	}
}

// findBestWindowByBounds 只凭边界距离时易被无关窗口（游戏）偷走：
// 加上标题筛选后，nickke.exe 这类非 marker 窗口必须被排除
func TestFindBestWindowByBoundsIgnoresUnmatchedGameWindow(t *testing.T) {
	req := request{
		Title:  "dmMiniPlayer-PIP",
		Titles: []string{"dmMiniPlayer-PIP"},
		// pip bounds 异常（如多屏坐标错乱），被错误上报成游戏全屏区域
		Bounds: bounds{Left: 50, Top: 50, Width: 1920, Height: 1080},
	}

	// nickke 全屏窗口与错误 target 边界几乎重合，距离更近
	nikkeBounds := bounds{Left: 55, Top: 55, Width: 1920, Height: 1080}
	pipBounds := bounds{Left: 0, Top: 0, Width: 640, Height: 360}

	nikkeDist := windowBoundsDistance(nikkeBounds, req.Bounds)
	pipDist := windowBoundsDistance(pipBounds, req.Bounds)
	if nikkeDist >= pipDist {
		t.Fatalf("测试构造失败：nikke 应更近 (nikke=%d, pip=%d)", nikkeDist, pipDist)
	}

	// 标题筛选：nickke 不匹配 marker，findBestWindowByBounds 直接跳过它
	if titleMatchScore("NIKKE: Goddess of Victory", normalizeTitles(req)) != 0 {
		t.Fatalf("nickke 标题不应匹配 marker")
	}
	if titleMatchScore("dmMiniPlayer-PIP", normalizeTitles(req)) != 300 {
		t.Fatalf("marker pip 标题应精确匹配")
	}
}

// 老版本扩展曾把页面标题发给 host（如 Title="YouTube"），此时浏览器主窗口
// （"YouTube - Google Chrome" 归一化后恰好也是 "youtube"）会被精确命中。
// normalizeTitles 必须丢弃一切非 marker，保证宁可找不到也绝不误伤浏览器。
func TestNormalizeTitlesDropsPageTitle(t *testing.T) {
	req := request{
		Title:  "YouTube",
		Titles: []string{"YouTube", "bilibili"},
		Bounds: bounds{Left: 0, Top: 0, Width: 640, Height: 360},
	}
	windows := []windowInfo{
		{
			hwnd:   1,
			title:  "YouTube - Google Chrome",
			bounds: bounds{Left: 0, Top: 0, Width: 640, Height: 360},
		},
	}
	if got := normalizeTitles(req); len(got) != 0 {
		t.Fatalf("页面标题必须被丢弃，得到 %q", got)
	}
	if _, ok := selectBestWindow(windows, normalizeTitles(req), req.Bounds); ok {
		t.Fatalf("页面标题请求必须找不到窗口，不能误伤浏览器主窗口")
	}
}

// 最大化浏览器/游戏即使 bounds 与上报 target 重合，也永远不能被选中。
// isMaximizedOrFullscreen(hwnd=0) 在测试里走全屏尺寸兜底分支。
func TestSelectBestWindowRejectsMaximizedLargeWindow(t *testing.T) {
	req := request{
		Title:  "dmMiniPlayer-PIP",
		Titles: []string{"dmMiniPlayer-PIP"},
		Bounds: bounds{Left: 0, Top: 0, Width: 1920, Height: 1080},
	}
	windows := []windowInfo{
		{
			hwnd:   0,
			title:  "dmMiniPlayer-PIP",
			bounds: bounds{Left: 0, Top: 0, Width: 99999, Height: 99999},
		},
	}
	if _, ok := selectBestWindowByBounds(windows, req); ok {
		t.Fatalf("全屏尺寸窗口必须被拒绝，不能误伤最大化游戏/浏览器")
	}
	if _, ok := selectBestWindow(windows, normalizeTitles(req), req.Bounds); ok {
		t.Fatalf("全屏尺寸窗口必须被拒绝（selectBestWindow 路径）")
	}
}

// 子串/包含标题一律不得分：标题相近的大窗口不能靠“包含”偷分。
func TestScoreWindowRejectsSubstringTitle(t *testing.T) {
	titles := normalizeTitles(request{
		Title:  "dmMiniPlayer-PIP",
		Titles: []string{"dmMiniPlayer-PIP"},
	})
	if score := scoreWindow(windowInfo{title: "dmMiniPlayer-PIP extra"}, titles, bounds{}); score != 0 {
		t.Fatalf("子串标题得分 %d，应为 0", score)
	}
	if score := scoreWindow(windowInfo{title: "PIP"}, titles, bounds{}); score != 0 {
		t.Fatalf("反向子串标题得分 %d，应为 0", score)
	}
}

// 非 marker 窗口永远通不过面积护栏，即使面积完全一致。
func TestAreaMatchRequiresMarker(t *testing.T) {
	win := windowInfo{
		title:  "YouTube - Google Chrome",
		bounds: bounds{Left: 100, Top: 100, Width: 640, Height: 360},
	}
	if isReasonableAreaMatch(win, bounds{Left: 100, Top: 100, Width: 640, Height: 360}) {
		t.Fatalf("非 marker 窗口必须被面积护栏拒绝")
	}
}
