
=================================================================
 innoextract - A tool to unpack installers created by Inno Setup
=================================================================

Inno Setup (http://www.jrsoftware.org/isinfo.php) is a tool to create
installers for Microsoft Windows applications. innoextract allows to extract
such installers under non-Windows systems without running the actual installer
using wine. innoextract currently supports installers created by Inno Setup
1.2.10 to 5.5.3.

innoextract is available under the ZLIB license - see the LICENSE file.

See the website for Linux packages
(http://constexpr.org/innoextract/#packages).


 Contact
=========

Website: http://constexpr.org/innoextract/

Author: Daniel Scharrer (http://constexpr.org/)


 Run
=====

To extract a setup file to the current directory run:

    innoextract <file>

A list of available options can be retrieved using

    innoextract --help

Documentation is also available as a man page:

    see doc/innoextract.1.txt


 Limitations
=============

 - innoextract currently only supports extracting all the data. There is no
   support for extracting individual files or components and limited support
   for extracting language-specific files.

 - Included scripts and checks are not executed.

 - The mapping from Inno Setup variables like the application directory to
   subdirectories is hard-coded.

 - innoextract does not check if an installer includes multiple files with
   the same name and will continually overwrite the destination file when
   extracting.

 - Names for data slice/disk files in multi-file installers must follow the
   standard naming scheme.

 - Encrypted installers are not supported.

A perhaps more complete, but Windows-only, tool to extract Inno Setup files
is innounp (http://innounp.sourceforge.net/).

Extracting Windows installer executables created by programs other than Inno
Setup is out of the scope of this project. Some of these can be unpacked by
the following programs:

 - cabextract: http://www.cabextract.org.uk/

 - unshield: http://www.synce.org/oldwiki/index.php/Unshield


 Disclaimer
============

This project is in no way associated with Inno Setup or www.jrsoftware.org.
