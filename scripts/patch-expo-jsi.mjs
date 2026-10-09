// expo-modules-jsi 57.0.5 annotated the RuntimeScheduler constructors with
// SWIFT_RETURNS_RETAINED to silence an Xcode 27 warning. The clang in Xcode 26
// (Apple clang 17) rejects that annotation on a constructor, so the iOS build
// fails with "cannot be annotated with either SWIFT_RETURNS_RETAINED or
// SWIFT_RETURNS_UNRETAINED". This keeps the annotation for newer compilers
// only.
//
// The same package also relies on concurrency analysis from Swift 6.3: under
// Swift 6.2 its JavaScriptRuntime.swift fails with "sending '...' risks causing
// data races". On an older compiler the target builds in Swift 5 language
// mode, where those diagnostics are warnings.
//
// Delete this script when the project requires Xcode 27.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const header = 'node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI-Cxx/include/RuntimeScheduler.h'
const MARK = 'HERMES_CTOR_RETAINED'

if (existsSync(header)) {
  const source = readFileSync(header, 'utf8')

  if (!source.includes(MARK)) {
    const patched = source
      .replaceAll('SWIFT_RETURNS_RETAINED RuntimeScheduler(', `${MARK} RuntimeScheduler(`)
      .replace(
        '#include <swift/bridging>',
        `#include <swift/bridging>\n#if defined(__clang_major__) && __clang_major__ > 17\n#define ${MARK} SWIFT_RETURNS_RETAINED\n#else\n#define ${MARK}\n#endif`
      )

    if (patched === source || !patched.includes(`#define ${MARK}`)) {
      throw new Error(`patch-expo-jsi: ${header} no longer has the expected shape. Check whether the patch is still needed.`)
    }

    writeFileSync(header, patched)
    console.log('patch-expo-jsi: patched RuntimeScheduler.h for Xcode 26')
  }
}

const manifest = 'node_modules/expo-modules-jsi/apple/Package.swift'
const ANCHOR = '.interoperabilityMode(.Cxx),'
const LANGUAGE_MODE = '.swiftLanguageMode(.v5),'
// Swift 6 behaviour the sources depend on, which Swift 5 mode does not turn on by itself.
const FEATURES = [
  'BareSlashRegexLiterals',
  'IsolatedDefaultValues',
  'ImplicitOpenExistentials',
  'ForwardTrailingClosures',
  'ConciseMagicFile',
  'DisableOutwardActorInference',
  // These two change which closures are @Sendable, and so the mangled names
  // that ExpoModulesCore links against. Without them the app fails at launch
  // with a dyld "Symbol not found" for JavaScriptActor.runIsolated.
  'GlobalActorIsolatedTypesUsability',
  'InferSendableFromCaptures'
]

function swiftVersion() {
  try {
    const match = /Swift version (\d+)\.(\d+)/.exec(execFileSync('xcrun', ['swift', '--version'], { encoding: 'utf8' }))

    return match ? [Number(match[1]), Number(match[2])] : null
  } catch {
    return null
  }
}

if (existsSync(manifest)) {
  const version = swiftVersion()
  const source = readFileSync(manifest, 'utf8')

  if (version && (version[0] < 6 || (version[0] === 6 && version[1] < 3)) && !source.includes(LANGUAGE_MODE)) {
    if (!source.includes(ANCHOR)) {
      throw new Error(`patch-expo-jsi: ${manifest} no longer has the expected shape. Check whether the patch is still needed.`)
    }

    // The first match is the ExpoModulesJSI target itself; later ones are tests.
    const settings = [LANGUAGE_MODE, ...FEATURES.map(feature => `.enableUpcomingFeature("${feature}"),`)]

    writeFileSync(manifest, source.replace(ANCHOR, [ANCHOR, ...settings].join('\n        ')))
    console.log(`patch-expo-jsi: Swift ${version.join('.')} found, building ExpoModulesJSI in Swift 5 language mode`)
  }
}
