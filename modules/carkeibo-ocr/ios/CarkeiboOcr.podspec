Pod::Spec.new do |s|
  s.name           = 'CarkeiboOcr'
  s.version        = '1.0.0'
  s.summary        = '端末の中で写真の文字を読む（Apple Vision）'
  s.description    = 'カーケイボーのレシート・メーターの読み取り用。日本語と英数字を認識する'
  s.license        = 'UNLICENSED'
  s.author         = '株式会社HOLY'
  s.homepage       = 'https://github.com/holy-auto/Carkeiboh'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Vision'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
