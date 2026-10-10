Pod::Spec.new do |s|
  s.name           = 'HermesDuplexAudio'
  s.version        = '1.0.0'
  s.summary        = 'Microphone PCM in and PCM playback out at the same time, with echo cancellation.'
  s.description    = 'The audio of a Hermes voice call: one AVAudioEngine with voice processing.'
  s.author         = 'Hermes'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,mm,swift}'
end
