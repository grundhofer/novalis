// Loads a page in a WKWebView, WebKit as the app uses it, and measures it
// (ADR-0051 #69). Used by scripts/measure-tab-row.mjs; see there.
//
// Usage: harness <url> <out.png> <width> <height> <measure.js> <stub.js>
//        [-AppleShowScrollBars Always|WhenScrolling]
// `stub.js` runs before the page's own scripts. `measure.js` is one
// expression; it is evaluated every 250 ms until it gives something other
// than null, which is printed as JSON on stdout. Then the window is captured
// to `out.png` and the harness exits. The window floats above the others
// while it measures: WebKit does not paint a window that is covered.
import AppKit
import WebKit

let args = CommandLine.arguments
guard args.count >= 7, let url = URL(string: args[1]), let width = Double(args[3]), let height = Double(args[4]) else {
  FileHandle.standardError.write("usage: harness <url> <out.png> <width> <height> <measure.js> <stub.js>\n".data(using: .utf8)!)
  exit(2)
}
let out = URL(fileURLWithPath: args[2])
let measure = try! String(contentsOfFile: args[5], encoding: .utf8)
let stub = try! String(contentsOfFile: args[6], encoding: .utf8)

final class Measurer: NSObject, WKNavigationDelegate {
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { poll(webView) }

  func poll(_ webView: WKWebView) {
    webView.evaluateJavaScript("JSON.stringify((function () { return \(measure); })())") { result, error in
      guard let text = result as? String, text != "null" else {
        if let error { FileHandle.standardError.write("\(error)\n".data(using: .utf8)!) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.poll(webView) }
        return
      }
      print(text)
      let capture = Process()
      capture.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
      capture.arguments = ["-x", "-o", "-l", String(webView.window!.windowNumber), out.path]
      do { try capture.run() } catch {
        FileHandle.standardError.write("screencapture: \(error)\n".data(using: .utf8)!)
        exit(1)
      }
      capture.waitUntilExit()
      exit(capture.terminationStatus == 0 ? 0 : 1)
    }
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let config = WKWebViewConfiguration()
// No cache: every run measures the build as it is now.
config.websiteDataStore = .nonPersistent()
config.userContentController.addUserScript(WKUserScript(source: stub, injectionTime: .atDocumentStart, forMainFrameOnly: true))
let frame = NSRect(x: 0, y: 0, width: width, height: height)
let window = NSWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
let view = WKWebView(frame: frame, configuration: config)
let measurer = Measurer()
view.navigationDelegate = measurer
window.contentView = view
window.level = .floating
window.orderFrontRegardless()
view.load(URLRequest(url: url))
DispatchQueue.main.asyncAfter(deadline: .now() + 30) {
  FileHandle.standardError.write("timeout: the page never measured\n".data(using: .utf8)!)
  exit(1)
}
app.run()
